/**
 * Live production through the product path.
 *
 * Creates a real series and production on the hosted database, funds the
 * ledger the way a Stripe payment would, queues advance_production, and runs
 * the same runner loop the Cloudflare cron runs until the production is ready
 * (or stops). Every take, measurement, gate and dollar goes through the
 * engine exactly as it would for a paying user. At the end the finals, SRT,
 * provenance and audit are downloaded to assets/live/<slug>/.
 *
 *   node --import tsx scripts/live-production.ts --length 60_90 --cap 25 --title "..." --idea "..."
 *   node --import tsx scripts/live-production.ts --resume <production_id> --cap 220
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";
import { runOnce } from "../src/engine/jobs/runner.ts";
import { retailForBlock, type EpisodeLength } from "../src/engine/config/catalog.ts";
import { estimateSeries } from "../src/engine/config/skus.ts";
import { PRICE_SNAPSHOT_VERSION } from "../src/engine/config/models.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { hydrateAssetStore } from "../src/engine/store-postgres.ts";
import type { Asset } from "../src/engine/domain.ts";

type Args = {
  length: EpisodeLength;
  cap: number;
  title: string;
  idea: string;
  resume: string | null;
  concurrency: number;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const length = (get("--length") ?? "60_90") as EpisodeLength;
  return {
    length,
    cap: Number(get("--cap") ?? (length === "900_1080" ? 220 : 25)),
    title: get("--title") ?? "The Tuesday Paper",
    idea:
      get("--idea") ??
      "A fictional billionaire's fiancée finds a dated letter in the estate kitchen that names another woman. Public confrontation, a witness who saw more than she says, and a final question no one can pay for yet.",
    resume: get("--resume") ?? null,
    concurrency: Number(get("--concurrency") ?? 3),
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let productionId = args.resume;
  let seriesId: string;
  let ownerId: string;

  if (!productionId) {
    const email = process.env.ADMIN_EMAIL?.trim();
    if (!email) throw new Error("ADMIN_EMAIL is required to own the live production");
    const { data: users, error: usersError } = await client.auth.admin.listUsers({ perPage: 200 });
    if (usersError) throw new Error(usersError.message);
    const owner = users.users.find((row) => row.email?.toLowerCase() === email.toLowerCase());
    if (!owner) throw new Error(`No auth user with email ${email}`);
    ownerId = owner.id;

    const { data: series, error: seriesError } = await client
      .from("series")
      .insert({
        owner_id: ownerId,
        title: args.title,
        description: args.idea,
        style_profile: { episode_length: args.length },
        target_episode_count: 60,
        sku: "60",
      })
      .select("*")
      .single();
    if (seriesError) throw new Error(seriesError.message);
    seriesId = series.id;

    // Fund the series the way a paid checkout does: retail for one episode at
    // this length, recorded as a purchase so reserve/settle run against a real balance.
    const retail = retailForBlock(2, "balanced", args.length) / 2;
    const { error: ledgerError } = await client.from("project_ledger").insert({
      owner_id: ownerId,
      series_id: seriesId,
      entry_type: "purchase",
      amount: retail,
      generation_job_id: null,
      stripe_event_id: `live_${Date.now()}`,
      price_snapshot_version: PRICE_SNAPSHOT_VERSION,
    });
    if (ledgerError) throw new Error(ledgerError.message);

    const { data: production, error: productionError } = await client
      .from("productions")
      .insert({
        owner_id: ownerId,
        series_id: seriesId,
        mode: "autopilot",
        sku: "2",
        priority: "balanced",
        episode_length: args.length,
        episode_start: 1,
        episode_end: 1,
        status: "queued",
        ui_phase: "preparing",
        paid_amount: retail,
        agent_decision: "Live verification production started.",
      })
      .select("*")
      .single();
    if (productionError) throw new Error(productionError.message);
    productionId = production.id;
    const { error: taskError } = await client.from("engine_tasks").insert({
      owner_id: ownerId,
      series_id: seriesId,
      production_id: productionId,
      action: "advance_production",
      payload: { production_id: productionId },
      status: "queued",
    });
    if (taskError) throw new Error(taskError.message);
    const estimate = estimateSeries({ episode_count: 2, length: args.length });
    process.stdout.write(
      `production ${productionId} · series ${seriesId} · ${args.length} · funded $${retail.toFixed(2)} · est COGS $${(estimate.estimated_min / 2).toFixed(2)}–$${(estimate.estimated_max / 2).toFixed(2)} · cap $${args.cap}\n`,
    );
  } else {
    const { data: production, error } = await client.from("productions").select("*").eq("id", productionId).single();
    if (error) throw new Error(error.message);
    seriesId = production.series_id;
    ownerId = production.owner_id;
    process.stdout.write(`resuming production ${productionId} · series ${seriesId} · status ${production.status}\n`);
    // After a QC fix: re-judge every shot whose takes were all blocked, on the same bytes.
    if (process.argv.includes("--rejudge") || process.argv.includes("--rejudge-all")) {
      const { data: blocked } = await client
        .from("generation_jobs")
        .select("shot_id, result_metadata")
        .eq("series_id", seriesId)
        .eq("job_type", "video");
      const byShot = new Map<string, { blocked: number; clean: number }>();
      for (const job of blocked ?? []) {
        if (!job.shot_id) continue;
        const meta = (job.result_metadata ?? {}) as Record<string, unknown>;
        if (typeof meta.asset_id !== "string") continue;
        const row = byShot.get(job.shot_id) ?? { blocked: 0, clean: 0 };
        if (!Array.isArray(meta.take_blockers) || meta.take_blockers.length) row.blocked += 1;
        else row.clean += 1;
        byShot.set(job.shot_id, row);
      }
      let queued = 0;
      const all = process.argv.includes("--rejudge-all");
      for (const [shotId, row] of byShot) {
        if (!all && (row.blocked === 0 || row.clean > 0)) continue;
        await client.from("engine_tasks").insert({ owner_id: ownerId, series_id: seriesId, production_id: productionId, action: "rejudge_shot", payload: { shot_id: shotId }, status: "queued" });
        queued += 1;
      }
      process.stdout.write(`queued rejudge for ${queued} shot(s)\n`);
    }
    // After a first-frame fix: reject every generated single seeded from a
    // non-CU still so it is reshot from a proper close-up.
    if (process.argv.includes("--reshoot-non-cu")) {
      const { data: jobs } = await client
        .from("generation_jobs")
        .select("shot_id, request_metadata, result_metadata, model")
        .eq("series_id", seriesId)
        .eq("job_type", "video");
      let queued = 0;
      for (const job of jobs ?? []) {
        const req = (job.request_metadata ?? {}) as Record<string, unknown>;
        const res = (job.result_metadata ?? {}) as Record<string, unknown>;
        if (!job.shot_id || typeof res.asset_id !== "string" || job.model === "plate/zoompan") continue;
        if (req.first_frame_kind === "cu" || req.first_frame_kind === "object") continue;
        await client.from("engine_tasks").insert({
          owner_id: ownerId,
          series_id: seriesId,
          production_id: productionId,
          action: "review_take",
          payload: { shot_id: job.shot_id, asset_id: res.asset_id, decision: "reject", note: `first frame was ${String(req.first_frame_kind)}; reshoot from CU` },
          status: "queued",
        });
        queued += 1;
      }
      process.stdout.write(`queued ${queued} rejection(s) of non-CU-seeded takes\n`);
    }
    // Reviewer pass: formally reject every blocked take so the retry cap resets and the shot reshoots.
    if (process.argv.includes("--reject-blocked")) {
      const { data: jobs } = await client.from("generation_jobs").select("shot_id, result_metadata").eq("series_id", seriesId).eq("job_type", "video");
      let queued = 0;
      for (const job of jobs ?? []) {
        const res = (job.result_metadata ?? {}) as Record<string, unknown>;
        if (!job.shot_id || typeof res.asset_id !== "string" || !Array.isArray(res.take_blockers) || !res.take_blockers.length) continue;
        await client.from("engine_tasks").insert({
          owner_id: ownerId,
          series_id: seriesId,
          production_id: productionId,
          action: "review_take",
          payload: { shot_id: job.shot_id, asset_id: res.asset_id, decision: "reject", note: `blocked: ${(res.take_blockers as string[]).join(",")}` },
          status: "queued",
        });
        queued += 1;
      }
      process.stdout.write(`queued ${queued} rejection(s) of blocked takes\n`);
    }
    // Same as the Resume button: clear the stop and queue the next advance.
    if (production.status === "needs_user" || production.paused) {
      await client
        .from("productions")
        .update({ status: "queued", paused: false, intervention_type: null, intervention: {}, ui_phase: "preparing", agent_decision: "Resumed by live driver.", updated_at: new Date().toISOString() })
        .eq("id", productionId);
      await client.from("engine_tasks").insert({
        owner_id: ownerId,
        series_id: seriesId,
        production_id: productionId,
        action: "advance_production",
        payload: { production_id: productionId },
        status: "queued",
      });
    }
  }

  const started = Date.now();
  let lastLine = "";
  for (;;) {
    await runOnce(client, args.concurrency);

    const [{ data: production }, { data: ledger }, { data: tasks }, { data: episodes }] = await Promise.all([
      client.from("productions").select("status, ui_phase, agent_decision, intervention").eq("id", productionId).single(),
      client.from("project_ledger").select("entry_type, amount").eq("series_id", seriesId),
      client.from("engine_tasks").select("action, status").eq("production_id", productionId),
      client.from("episodes").select("id, status").eq("series_id", seriesId),
    ]);
    const spent = (ledger ?? []).filter((row) => row.entry_type === "settle").reduce((sum, row) => sum + Number(row.amount), 0);
    const reserved =
      (ledger ?? []).filter((row) => row.entry_type === "reserve").reduce((sum, row) => sum + Number(row.amount), 0) -
      (ledger ?? []).filter((row) => row.entry_type === "release").reduce((sum, row) => sum + Number(row.amount), 0);
    const counts = new Map<string, number>();
    for (const task of tasks ?? []) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    const running = (tasks ?? []).filter((row) => row.status === "running").map((row) => row.action);
    const line = `${((Date.now() - started) / 60000).toFixed(1)}m · ${production?.status}/${production?.ui_phase} · spent $${spent.toFixed(2)} (+$${Math.max(0, reserved).toFixed(2)} held) · tasks ${[...counts.entries()].map(([status, count]) => `${status}:${count}`).join(" ")}${running.length ? ` · ${running.join(",")}` : ""}`;
    if (line !== lastLine) {
      process.stdout.write(`${line}\n`);
      lastLine = line;
    }

    if (spent + Math.max(0, reserved) > args.cap) {
      await client.from("productions").update({ paused: true, agent_decision: `Paused by live driver: spend cap $${args.cap} reached.`, updated_at: new Date().toISOString() }).eq("id", productionId);
      process.stdout.write(`SPEND CAP REACHED ($${(spent + reserved).toFixed(2)} > $${args.cap}); production paused.\n`);
      break;
    }
    if (production?.status === "ready") {
      process.stdout.write(`READY · episodes ${(episodes ?? []).map((row) => row.status).join(",")}\n`);
      break;
    }
    if (production?.status === "needs_user" || production?.status === "failed" || production?.status === "cancelled") {
      process.stdout.write(`STOPPED · ${production.status} · ${production.agent_decision ?? ""} · ${JSON.stringify(production.intervention ?? {})}\n`);
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 4000));
  }

  // Deliverables: whatever finals exist, plus captions, provenance and audit.
  const { data: assetRows } = await client
    .from("assets")
    .select("*")
    .eq("series_id", seriesId)
    .in("kind", ["episode_final", "episode_captions", "episode_provenance", "episode_audit"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets as never, (assetRows ?? []) as Asset[]);
  const dir = resolve(process.cwd(), "assets", "live", `${slug(args.title)}-${args.length}-${String(productionId).slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  const saved: string[] = [];
  for (const row of (assetRows ?? []) as Asset[]) {
    const stored = await assets.get(row.id).catch(() => null);
    if (!stored) continue;
    const meta = row.metadata as Record<string, unknown>;
    const version = typeof meta.version === "number" ? `v${meta.version}` : "v";
    const aspect = typeof meta.aspect === "string" ? meta.aspect.replace(":", "x") : "";
    const name =
      row.kind === "episode_final"
        ? `final-${version}-${aspect || "9x16"}.mp4`
        : row.kind === "episode_captions"
          ? `captions-${version}.srt`
          : row.kind === "episode_provenance"
            ? `provenance-${version}.json`
            : `audit-${row.id.slice(0, 8)}.json`;
    await writeFile(resolve(dir, name), stored.body);
    saved.push(name);
  }
  await writeFile(
    resolve(dir, "run.json"),
    JSON.stringify({ production_id: productionId, series_id: seriesId, owner_id: ownerId, length: args.length, saved, finished_at: new Date().toISOString() }, null, 2),
  );
  process.stdout.write(`saved ${saved.length} file(s) to ${dir}\n${saved.map((name) => `  ${name}`).join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
