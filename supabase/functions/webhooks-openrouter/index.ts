import { json, serviceClient } from "../_shared/auth.ts";
import { wakeJobs } from "../_shared/jobs.ts";

const ACTIVE = ["queued", "submitting", "generating", "ingesting"];

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/**
 * OpenRouter cannot sign callbacks, so the callback URL the engine registers
 * carries two secrets: a per-job single-use token and a platform-wide shared
 * secret. Both must match. The token is consumed by the engine once ingest
 * reaches a terminal state; replays before that only bump a counter.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("OPENROUTER_WEBHOOK_SECRET")?.trim() ?? "";
  if (!expectedSecret) return json({ error: "OPENROUTER_WEBHOOK_SECRET is not configured" }, 500);

  const url = new URL(req.url);
  const presentedSecret = req.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
  if (!presentedSecret || !timingSafeEqual(presentedSecret, expectedSecret)) {
    return json({ error: "Invalid webhook secret" }, 401);
  }

  const token = url.searchParams.get("token") ?? "";
  if (!token || token.length > 256) return json({ error: "Missing callback token" }, 401);

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const upstreamFromBody =
    typeof body.id === "string" ? body.id : typeof body.job_id === "string" ? body.job_id : null;

  const supabase = serviceClient();
  const { data: job, error } = await supabase
    .from("generation_jobs")
    .select("id, status, callback_token_used, provider, upstream_job_id, result_metadata")
    .eq("callback_token", token)
    .maybeSingle();

  if (error || !job) return json({ error: "Invalid callback token" }, 401);
  if (job.callback_token_used) return json({ error: "Invalid callback token" }, 401);
  if (upstreamFromBody && job.upstream_job_id && upstreamFromBody !== job.upstream_job_id) {
    return json({ error: "Callback does not match this job" }, 409);
  }
  if (!ACTIVE.includes(job.status)) {
    return json({ ok: true, ignored: true });
  }

  const prior = (job.result_metadata ?? {}) as Record<string, unknown>;
  const replays = Number(prior.webhook_received_count ?? 0);
  const { data: updated, error: updateError } = await supabase
    .from("generation_jobs")
    .update({
      result_metadata: {
        ...prior,
        webhook_received_at: prior.webhook_received_at ?? new Date().toISOString(),
        webhook_last_received_at: new Date().toISOString(),
        webhook_received_count: replays + 1,
        webhook_status: typeof body.status === "string" ? body.status : prior.webhook_status ?? null,
        ingest_requested: true,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("callback_token_used", false)
    .select("id")
    .maybeSingle();

  if (updateError) return json({ error: "Failed to record webhook" }, 500);
  if (!updated) return json({ error: "Invalid callback token" }, 401);
  // A first delivery wakes the runner. Replays are recorded but do not fan out.
  if (replays === 0) await wakeJobs();
  return json({ ok: true, job_id: job.id, ingest_requested: true, replay: replays > 0 });
});
