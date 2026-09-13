/**
 * Shoot a 60s episode 1 locally as Seedance scene takes.
 * Does not queue engine_tasks, so a hosted runner cannot rewrite the plan.
 *
 *   npx tsx scripts/shoot-ep1-scene-takes.ts
 *   npx tsx scripts/shoot-ep1-scene-takes.ts --resume
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { PRICE_SNAPSHOT_VERSION } from "../src/engine/config/models.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { Asset, GenerationJob, Shot } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function orderedShots(engine: ReturnType<typeof createEngine>, episodeId: string): Shot[] {
  const scenes = engine.store.scenesFor(episodeId).sort((a, b) => a.position - b.position);
  return scenes.flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
}

const HARD_SCENE_TAKE_BLOCKERS = new Set(["modest_dress", "identity_drift", "native_audio_missing", "no_speech"]);

function bestUsableTake(store: ReturnType<typeof createEngine>["store"], shot: Shot): { assetId: string; score: number; blockers: string[] } | null {
  const ranked: Array<{ assetId: string; score: number; blockers: string[] }> = [];
  for (const job of store.jobs.values()) {
    if (job.shot_id !== shot.id || job.job_type !== "video") continue;
    const assetId = job.result_metadata.asset_id;
    if (typeof assetId !== "string") continue;
    const blockers = Array.isArray(job.result_metadata.take_blockers)
      ? (job.result_metadata.take_blockers as string[])
      : [];
    const score = typeof job.result_metadata.take_score === "number" ? job.result_metadata.take_score : 0;
    ranked.push({ assetId, score, blockers });
  }
  ranked.sort((a, b) => a.blockers.length - b.blockers.length || b.score - a.score);
  return ranked[0] ?? null;
}

function canKeepSceneTake(row: { assetId: string; blockers: string[] }): boolean {
  return row.blockers.every((reason) => !HARD_SCENE_TAKE_BLOCKERS.has(reason));
}

function planSummary(shots: Shot[]) {
  return {
    shotCount: shots.length,
    sceneTakes: shots.filter((shot) => isSceneTake(shot.shot_data)).length,
    seconds: shots.reduce((acc, shot) => acc + shot.shot_data.duration_hint_seconds, 0),
    takes: shots.map((shot) => ({
      id: shot.id,
      fn: shot.shot_data.function,
      mode: shot.shot_data.edit_mode,
      status: shot.status,
      dur: shot.shot_data.duration_hint_seconds,
      dlg: shot.shot_data.dialogue,
      lines: (shot.shot_data.scene_script ?? "").split("\n").filter(Boolean).length,
    })),
  };
}

function isValidSceneTakePlan(shots: Shot[]): boolean {
  const sceneTakes = shots.filter((shot) => isSceneTake(shot.shot_data));
  return shots.length >= 4 && shots.length <= 6 && sceneTakes.length === shots.length;
}

function enqueueActiveVideo(engine: ReturnType<typeof createEngine>, shots: Shot[]) {
  const shotIds = new Set(shots.map((shot) => shot.id));
  const queued = new Set(engine.store.queue.map((task) => task.job_id));
  for (const job of engine.store.jobs.values()) {
    if (!job.shot_id || !shotIds.has(job.shot_id) || job.job_type !== "video") continue;
    if (job.status !== "queued" && job.status !== "generating" && job.status !== "submitting") continue;
    if (queued.has(job.id)) continue;
    engine.store.queue.push({
      id: `local-${job.id}`,
      job_id: job.id,
      kind: "generate",
      created_at: job.created_at,
      visible_at: new Date().toISOString(),
    });
    queued.add(job.id);
  }
}

async function main() {
  loadLocalEnv();
  const resume = process.argv.includes("--resume");
  const fromArg = process.argv.find((arg) => arg.startsWith("--from="));
  const fromIndex = fromArg ? Math.max(0, Number(fromArg.slice("--from=".length)) - 1) : 0;
  const forceFrom = Boolean(fromArg);
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: series } = await client.from("series").select("owner_id").eq("id", SERIES_ID).single();
  if (!series) throw new Error("Series not found");
  const ownerId = series.owner_id;

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for local 60s scene-take ep1" })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);
  await client
    .from("productions")
    .update({
      paused: true,
      status: "needs_user",
      agent_decision: "Paused so episode 1 can reshoot locally as scene takes.",
      updated_at: new Date().toISOString(),
    })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);

  const existing = await loadSeriesStore(client, SERIES_ID);
  const existingAssets = createConfiguredAssetStore();
  hydrateAssetStore(existingAssets, existing.assets);
  const existingEngine = createEngine({
    store: existing.store,
    assets: existingAssets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    render: renderEpisodeBytes,
  });
  existingEngine.store.queue = [];
  const existingShots = orderedShots(existingEngine, EPISODE_ID);
  const keepPlan = resume || isValidSceneTakePlan(existingShots);

  if (!keepPlan) {
    await client.from("project_ledger").insert({
      owner_id: ownerId,
      series_id: SERIES_ID,
      entry_type: "purchase",
      amount: 50,
      generation_job_id: null,
      stripe_event_id: `live_ep1_scenetake_${Date.now()}`,
      price_snapshot_version: PRICE_SNAPSHOT_VERSION,
    });
    const { data: scenes } = await client.from("scenes").select("id").eq("episode_id", EPISODE_ID);
    if (scenes?.length) {
      const { error } = await client.from("scenes").delete().in(
        "id",
        scenes.map((row) => row.id),
      );
      if (error) throw new Error(error.message);
    }
    await client
      .from("series")
      .update({ style_profile: { episode_length: "60_90" }, updated_at: new Date().toISOString() })
      .eq("id", SERIES_ID);
    await client
      .from("episodes")
      .update({
        status: "draft",
        script: "",
        episode_outline: null,
        render_manifest: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", EPISODE_ID);
  }

  const loaded = keepPlan ? existing : await loadSeriesStore(client, SERIES_ID);
  const assets = keepPlan ? existingAssets : createConfiguredAssetStore();
  if (!keepPlan) hydrateAssetStore(assets, loaded.assets);
  const engine = keepPlan
    ? existingEngine
    : createEngine({
        store: loaded.store,
        assets,
        skipSeriesBudget: true,
        ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
        render: renderEpisodeBytes,
      });
  engine.store.queue = [];

  let shots = orderedShots(engine, EPISODE_ID);
  enqueueActiveVideo(engine, shots);
  if (!keepPlan || !isValidSceneTakePlan(shots)) {
    process.stdout.write("planning 60s scene-take episode 1…\n");
    const planned = await engine.planEpisode({
      owner_id: ownerId,
      episode_id: EPISODE_ID,
      episode_length: "60_90",
    });
    shots = [...planned.scenes]
      .sort((a, b) => a.position - b.position)
      .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
  } else {
    process.stdout.write("resuming existing 60s scene-take plan…\n");
  }
  if (forceFrom) {
    const resetIds = new Set<string>();
    for (const [index, shot] of shots.entries()) {
      if (index < fromIndex) continue;
      resetIds.add(shot.id);
      engine.store.shots.set(shot.id, {
        ...shot,
        status: "planned",
        selected_generation_id: null,
        shot_data: {
          ...shot.shot_data,
          heard_audio: "native",
          take_reviews: [],
        },
      });
    }
    for (const job of engine.store.jobs.values()) {
      if (!job.shot_id || !resetIds.has(job.shot_id) || job.job_type !== "video") continue;
      if (job.status !== "queued" && job.status !== "generating" && job.status !== "submitting") continue;
      engine.store.jobs.set(job.id, { ...job, status: "cancelled" });
    }
    engine.store.queue = engine.store.queue.filter((task) => {
      const job = engine.store.jobs.get(task.job_id);
      return !job?.shot_id || !resetIds.has(job.shot_id);
    });
    shots = orderedShots(engine, EPISODE_ID);
    process.stdout.write(`reshooting from take ${fromIndex + 1} with locked bible refs…\n`);
  }
  process.stdout.write(`${JSON.stringify(planSummary(shots), null, 2)}\n`);
  if (!isValidSceneTakePlan(shots)) {
    throw new Error(`Plan is not 4–6 scene takes (${shots.length} shots, ${shots.filter((shot) => isSceneTake(shot.shot_data)).length} scene takes)`);
  }
  await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);

  for (const [index, shot] of shots.entries()) {
    process.stdout.write(`shoot ${index + 1}/${shots.length} ${shot.id} ${shot.shot_data.function} ${shot.shot_data.duration_hint_seconds}s…\n`);
    const started = Date.now();
    let extraAttempts = 0;
    while (Date.now() - started < 50 * 60 * 1000) {
      enqueueActiveVideo(engine, shots);
      await engine.tick();
      await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
      const live = engine.store.shots.get(shot.id);
      if (live?.status === "complete") {
        process.stdout.write(`  complete ${shot.id}\n`);
        break;
      }
      const inflight = [...engine.store.jobs.values()].some(
        (job: GenerationJob) =>
          job.shot_id === shot.id &&
          job.job_type === "video" &&
          (job.status === "queued" || job.status === "generating" || job.status === "ingesting" || job.status === "qc"),
      );
      if (inflight) {
        await sleep(8000);
        continue;
      }
      const reshooting = forceFrom && index >= fromIndex;
      const usable = live ? bestUsableTake(engine.store, live) : null;
      if (!reshooting && live && usable && canKeepSceneTake(usable) && (live.status === "needs_review" || live.status === "planned" || live.status === "generating")) {
        process.stdout.write(`  approving ${usable.assetId} (score ${usable.score}, blockers ${usable.blockers.join(",") || "none"})\n`);
        await engine.reviewTake({
          owner_id: ownerId,
          shot_id: shot.id,
          asset_id: usable.assetId,
          decision: "approve",
          note: "keep the spoken Seedance scene take",
        });
        await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
        continue;
      }
      if (!inflight && extraAttempts < 3 && live?.status !== "complete" && (reshooting || !usable)) {
        extraAttempts += 1;
        process.stdout.write(`  ${live?.status ?? "missing"} ${shot.id} — generating (attempt ${extraAttempts}/3)\n`);
        try {
          const { job } = await engine.generateVideo({ owner_id: ownerId, shot_id: shot.id });
          const locks = job.request_metadata.image_locks;
          if (Array.isArray(locks) && locks.length) {
            process.stdout.write(`  refs ${JSON.stringify(locks)}\n`);
          }
          if (job.request_metadata.seedance_privacy_strip) {
            process.stdout.write(`  privacy strip ${String(job.request_metadata.seedance_privacy_strip)}\n`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed = [...engine.store.jobs.values()]
            .filter((row) => row.shot_id === shot.id && row.job_type === "video")
            .at(-1);
          if (failed && Array.isArray(failed.request_metadata.image_locks)) {
            process.stdout.write(`  refs ${JSON.stringify(failed.request_metadata.image_locks)}\n`);
          }
          if (/\b402\b/.test(message) || /insufficient|credits|payment required/i.test(message)) {
            throw new Error(`Stopped on 402: ${message}`);
          }
          const transient = /HTTP 500|HTTP 502|HTTP 503|HTTP 504|Internal Server Error|fetch failed|ECONNRESET|ETIMEDOUT|timed out|ProviderTimeoutError/i.test(
            message,
          );
          if (transient && extraAttempts < 3) {
            process.stdout.write(`  transient submit, will retry (${extraAttempts}/3)\n`);
            await sleep(12_000);
            continue;
          }
          throw error;
        }
        await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
      }
      await sleep(8000);
    }
    const done = engine.store.shots.get(shot.id);
    if (done?.status !== "complete") {
      throw new Error(`Shot ${shot.id} ended ${done?.status ?? "missing"}`);
    }
  }

  process.stdout.write("cutting episode 1…\n");
  const rendered = await engine.renderEpisode({ owner_id: ownerId, episode_id: EPISODE_ID });
  await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
  process.stdout.write(`render ${rendered.episode.status} checksum ${rendered.checksum ?? ""}\n`);

  const { data: assetRows } = await client
    .from("assets")
    .select("*")
    .eq("series_id", SERIES_ID)
    .in("kind", ["episode_final", "episode_captions", "episode_provenance", "episode_audit"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(8);
  const dir = resolve(process.cwd(), "assets", "live", "ep1-scene-takes-60s");
  await mkdir(dir, { recursive: true });
  hydrateAssetStore(assets, (assetRows ?? []) as Asset[]);
  const saved: string[] = [];
  for (const [index, shot] of orderedShots(engine, EPISODE_ID).entries()) {
    const takeId = shot.selected_generation_id;
    if (!takeId) continue;
    const take = await assets.get(takeId).catch(() => null);
    if (!take) continue;
    const name = `take-${index + 1}-${shot.shot_data.function ?? "scene"}.mp4`;
    await writeFile(resolve(dir, name), take.body);
    saved.push(name);
  }
  if (rendered.asset) {
    const finalBytes = await assets.get(rendered.asset.id).catch(() => null);
    if (finalBytes) {
      await writeFile(resolve(dir, "final-v3-9x16.mp4"), finalBytes.body);
      saved.push("final-v3-9x16.mp4");
    }
  }
  for (const row of (assetRows ?? []) as Asset[]) {
    const stored = await assets.get(row.id).catch(() => null);
    if (!stored) continue;
    const name =
      row.kind === "episode_final"
        ? "final-v3-9x16.mp4"
        : row.kind === "episode_captions"
          ? "captions-v3.srt"
          : row.kind === "episode_provenance"
            ? "provenance-v3.json"
            : `audit-${row.id.slice(0, 8)}.json`;
    if (row.kind === "episode_final" && saved.includes("final-v3-9x16.mp4")) continue;
    await writeFile(resolve(dir, name), stored.body);
    saved.push(name);
  }
  process.stdout.write(`READY · saved ${saved.join(", ")} to ${dir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
