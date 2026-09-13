/**
 * Approve the least-blocked existing take on named shots so a production
 * stopped on quality_budget can render instead of retrying video.
 *
 *   npx tsx scripts/approve-best-takes.ts <production_id> <shot_id> [shot_id...]
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

async function main() {
  loadLocalEnv();
  const [productionId, ...shotIds] = process.argv.slice(2);
  if (!productionId || shotIds.length === 0) {
    throw new Error("usage: approve-best-takes <production_id> <shot_id>...");
  }
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: production, error } = await client
    .from("productions")
    .select("owner_id, series_id")
    .eq("id", productionId)
    .single();
  if (error || !production) throw new Error(error?.message ?? "production missing");

  for (const shotId of shotIds) {
    const { data: jobs } = await client
      .from("generation_jobs")
      .select("id, result_metadata, created_at")
      .eq("shot_id", shotId)
      .eq("job_type", "video")
      .order("created_at", { ascending: false });
    const candidates = (jobs ?? [])
      .map((job) => {
        const res = (job.result_metadata ?? {}) as Record<string, unknown>;
        const assetId = typeof res.asset_id === "string" ? res.asset_id : null;
        const blockers = Array.isArray(res.take_blockers) ? (res.take_blockers as string[]) : [];
        return { assetId, blockers };
      })
      .filter((row): row is { assetId: string; blockers: string[] } => Boolean(row.assetId));
    candidates.sort((a, b) => a.blockers.length - b.blockers.length);
    const best = candidates[0];
    if (!best) {
      process.stdout.write(`${shotId.slice(0, 8)} no take to approve\n`);
      continue;
    }
    await client.from("engine_tasks").insert({
      owner_id: production.owner_id,
      series_id: production.series_id,
      production_id: productionId,
      action: "review_take",
      payload: {
        shot_id: shotId,
        asset_id: best.assetId,
        decision: "approve",
        note: `use best existing take (${best.blockers.length} blocker(s))`,
      },
      status: "queued",
    });
    process.stdout.write(`${shotId.slice(0, 8)} approve ${best.blockers.length} blocker(s)\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
