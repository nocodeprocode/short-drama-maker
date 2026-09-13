/**
 * Shoot episode 1 scene takes and write only the new raw MP4s.
 * Does not recut, does not approve old takes, does not write a final.
 *
 *   npx tsx scripts/shoot-ep1-raw.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { GenerationJob, Shot } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";
const OUT = resolve(process.cwd(), "assets", "live", "ep1-raw");

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function orderedShots(engine: ReturnType<typeof createEngine>, episodeId: string): Shot[] {
  return engine.store.scenesFor(episodeId)
    .sort((a, b) => a.position - b.position)
    .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
}

function enqueueJob(engine: ReturnType<typeof createEngine>, job: GenerationJob) {
  if (engine.store.queue.some((task) => task.job_id === job.id)) return;
  if (job.status !== "queued" && job.status !== "generating" && job.status !== "submitting") return;
  engine.store.queue.push({
    id: `raw-${job.id}`,
    job_id: job.id,
    kind: "generate",
    created_at: job.created_at,
    visible_at: new Date().toISOString(),
  });
}

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: series } = await client.from("series").select("owner_id").eq("id", SERIES_ID).single();
  if (!series) throw new Error("Series not found");
  const ownerId = series.owner_id;

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for raw ep1 shoot" })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);
  await client
    .from("productions")
    .update({
      paused: true,
      status: "needs_user",
      agent_decision: "Paused so episode 1 can shoot raw takes locally.",
      updated_at: new Date().toISOString(),
    })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);

  const loaded = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, loaded.assets);
  const engine = createEngine({
    store: loaded.store,
    assets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
  });
  engine.store.queue = [];

  const shots = orderedShots(engine, EPISODE_ID);
  if (shots.length < 4 || !shots.every((shot) => isSceneTake(shot.shot_data))) {
    throw new Error("Episode 1 is not a scene-take plan. Will not invent a new cut.");
  }

  await mkdir(OUT, { recursive: true });
  const rows: Array<Record<string, unknown>> = [];

  for (const [index, shot] of shots.entries()) {
    engine.store.shots.set(shot.id, {
      ...shot,
      status: "planned",
      selected_generation_id: null,
      shot_data: { ...shot.shot_data, heard_audio: "native", take_reviews: [] },
    });
    for (const job of engine.store.jobs.values()) {
      if (job.shot_id !== shot.id || job.job_type !== "video") continue;
      if (job.status === "queued" || job.status === "generating" || job.status === "submitting") {
        engine.store.jobs.set(job.id, { ...job, status: "cancelled" });
      }
    }
    engine.store.queue = [];

    process.stdout.write(`raw ${index + 1}/${shots.length} ${shot.id}\n`);
    const { job } = await engine.generateVideo({ owner_id: ownerId, shot_id: shot.id });
    const locks = Array.isArray(job.request_metadata.image_locks) ? job.request_metadata.image_locks : [];
    process.stdout.write(`  job ${job.id}\n`);
    process.stdout.write(`  refs ${JSON.stringify(locks)}\n`);
    if (job.request_metadata.seedance_privacy_strip) {
      process.stdout.write(`  privacy strip ${String(job.request_metadata.seedance_privacy_strip)}\n`);
    }
    await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);

    const started = Date.now();
    let live = engine.store.jobs.get(job.id)!;
    while (Date.now() - started < 50 * 60 * 1000) {
      enqueueJob(engine, live);
      await engine.tick();
      await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
      live = engine.store.jobs.get(job.id)!;
      if (live.status === "completed" || live.status === "needs_review") break;
      if (live.status === "failed" || live.status === "cancelled") {
        throw new Error(`Job ${job.id} ${live.status}: ${live.error_code ?? ""}`);
      }
      await sleep(8000);
    }
    const assetId = typeof live.result_metadata.asset_id === "string" ? live.result_metadata.asset_id : null;
    if (!assetId) throw new Error(`Job ${job.id} ended ${live.status} with no asset`);
    const stored = await assets.get(assetId);
    if (!stored) throw new Error(`Missing bytes for ${assetId}`);
    const name = `${String(index + 1).padStart(2, "0")}.mp4`;
    await writeFile(resolve(OUT, name), stored.body);
    const row = {
      file: name,
      bytes: stored.body.byteLength,
      shot_id: shot.id,
      job_id: live.id,
      asset_id: assetId,
      duration_hint_seconds: shot.shot_data.duration_hint_seconds,
      function: shot.shot_data.function,
      dialogue: shot.shot_data.dialogue,
      scene_script: shot.shot_data.scene_script,
      refs: locks,
      privacy_strip: live.request_metadata.seedance_privacy_strip ?? null,
      seedance_ref_mode: live.request_metadata.seedance_ref_mode ?? null,
      job_status: live.status,
    };
    rows.push(row);
    process.stdout.write(`  wrote ${name} ${stored.body.byteLength} bytes\n`);
  }

  const list = [
    "Episode 1 raw Seedance takes. Not cut. Not mixed with older files.",
    `Folder: ${OUT}`,
    "",
    ...rows.map((row, index) => {
      const refs = Array.isArray(row.refs) ? row.refs.map((lock) => `${(lock as { role: string }).role}:${(lock as { name: string }).name}`).join(", ") : "";
      return [
        `${index + 1}. ${row.file}`,
        `   duration hint: ${row.duration_hint_seconds}s`,
        `   function: ${row.function}`,
        `   job: ${row.job_id}`,
        `   asset: ${row.asset_id}`,
        `   refs: ${refs || "(none)"}`,
        `   privacy strip: ${row.privacy_strip ?? "none"}`,
        `   line: ${row.dialogue ?? ""}`,
        "",
      ].join("\n");
    }),
  ].join("\n");
  await writeFile(resolve(OUT, "LIST.txt"), list);
  await writeFile(resolve(OUT, "LIST.json"), JSON.stringify(rows, null, 2));
  process.stdout.write(`READY · ${rows.length} raw takes in ${OUT}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
