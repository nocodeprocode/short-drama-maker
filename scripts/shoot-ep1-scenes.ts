/**
 * Replan episode 1 as 4–6 full-length Seedance scene takes and shoot locally.
 * UAE public-decency lock. Does not queue hosted engine_tasks.
 *
 *   npx tsx scripts/shoot-ep1-scenes.ts
 *   npx tsx scripts/shoot-ep1-scenes.ts --resume
 *   npx tsx scripts/shoot-ep1-scenes.ts --cut-only
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { SCREENPLAY_RULES } from "../src/engine/domain.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { cueRows } from "../src/drama-engine/types/continuity.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { GenerationJob, Shot, StoryBible } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";
const OUT = resolve(process.cwd(), "assets", "live", "ep1-boss-delivery");
const TITLE = "Boss Marries the Delivery Driver Girl";
const LOGLINE =
  "When will the delivery driver girl who saved a stranger's life learn that the broke night clerk paying off her mother's hospital debt is the undercover boss of the city's crime family?";
const IDEA =
  "A night delivery driver finds a man collapsed on the floor of an all-night laundromat and keeps him breathing until he comes back. He tells her he is a night clerk. We know he is the undercover head of the city's crime family; she does not. He will find her again to pay her mother's hospital debt, and by the end of the season she stands beside him as the queen of the family. Episode 1: the rescue, the lie, the first tell, and the first unpaid question. Clean public-decency romance for UAE media: no kissing, no bedroom, no alcohol, no weapons, no blood, no crime on camera. Adults only. Modest dress. The tension is words, distance, and faces.";
const CAST_JOBS: Record<string, string> = {
  // First sentence is the on-screen intro label (≤6 words). Keep it that way.
  MARA: "Night delivery driver. Twenty-six. Works doubles to pay her mother's hospital debt. Pulled a stranger off a laundromat floor and made him breathe. Sharp, tired, kind under the sharpness, does not take charity. Engine.",
  COLE: "Undercover crime boss. Posing as a broke night clerk in a plain jacket. Collapsed from an untreated fever tonight; MARA saved his life. Controlled, amused, dangerous; the audience knows who he is, she does not. Wall.",
  FELIX: "The boss's driver. COLE's right hand. Calls him Boss out of habit. Arrives to collect him and nearly gives him away. Witness.",
  DIANA: "The rival family's daughter. Wants COLE's seat. Not in episode 1. Nuke.",
  PETRA: "Hospital billing clerk. Holds MARA's mother's file. Not in episode 1.",
};
const LOCATIONS = [
  "ALL-NIGHT LAUNDROMAT — one long steel folding counter, about two metres, standing free in the middle of a tiled room; a row of dryers glowing on the back wall; a rain-streaked window on the left; a single back door on the right; a lived-in place, not a set",
  "HOSPITAL BILLING OFFICE — small, one desk, one chair, a glass partition; daytime; not in episode 1",
  "FAMILY HOUSE STUDY — dark wood, one desk, one lamp; not in episode 1",
];

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function orderedShots(engine: ReturnType<typeof createEngine>, episodeId: string): Shot[] {
  return engine.store.scenesFor(episodeId)
    .sort((a, b) => a.position - b.position)
    .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
}

const HARD_SCENE_TAKE_BLOCKERS = new Set(["modest_dress", "identity_drift", "native_audio_missing", "no_speech"]);

function bestUsableTake(store: ReturnType<typeof createEngine>["store"], shot: Shot) {
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

function canKeepSceneTake(row: { blockers: string[] }): boolean {
  return row.blockers.every((reason) => !HARD_SCENE_TAKE_BLOCKERS.has(reason));
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
      id: `local-scene-${job.id}`,
      job_id: job.id,
      kind: "generate",
      created_at: job.created_at,
      visible_at: new Date().toISOString(),
    });
    queued.add(job.id);
  }
}

function paymentFailed(message: string): boolean {
  return /\b402\b/.test(message) || /insufficient|credits|payment required/i.test(message);
}

function patchBible(bible: StoryBible | null | undefined): StoryBible | null {
  if (!bible) return null;
  return {
    ...bible,
    title: TITLE,
    logline: LOGLINE,
    rules: { ...bible.rules, ...SCREENPLAY_RULES },
    locations: LOCATIONS,
    characters: (bible.characters ?? []).map((character) => {
      const key = character.name.trim().toUpperCase().split(/\s+/)[0] ?? "";
      const description = CAST_JOBS[key];
      return description ? { ...character, description } : character;
    }),
  };
}

function hasConversation(shots: Shot[]): boolean {
  return shots.every((shot) => cueRows(shot.shot_data.scene_script).length >= 4);
}

function hasCoverageMix(shots: Shot[]): boolean {
  return (
    shots.length >= 4 &&
    shots.every((shot) => {
      const coverage = shot.shot_data.blocking?.coverage;
      return !coverage || coverage === "two_shot" || coverage === "room";
    }) &&
    shots.every((shot) => shot.shot_data.blocking?.camera_left && shot.shot_data.blocking?.camera_right)
  );
}

function isCourierPlan(shots: Shot[]): boolean {
  const blob = shots
    .map((shot) => `${shot.shot_data.scene_script ?? ""} ${shot.shot_data.dialogue ?? ""} ${shot.shot_data.camera}`)
    .join("\n")
    .toLowerCase();
  if (/\b(scissors|tuesday|carrier|heiress|wolf)\b/.test(blob)) return false;
  return /\b(breathe|breathing|floor|clerk|delivery|driver|route|mother|hospital|debt|boss|ride)\b/.test(blob);
}

async function main() {
  loadLocalEnv();
  const cutOnly = process.argv.includes("--cut-only");
  const resume = cutOnly || process.argv.includes("--resume");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: seriesRow } = await client.from("series").select("owner_id, title, story_bible").eq("id", SERIES_ID).single();
  if (!seriesRow) throw new Error("Series not found");
  const ownerId = seriesRow.owner_id;

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for local UAE-safe scene-take ep1" })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);
  await client
    .from("productions")
    .update({
      paused: true,
      status: "needs_user",
      agent_decision: "Paused so episode 1 can shoot locally as full-length scene takes.",
      updated_at: new Date().toISOString(),
    })
    .eq("series_id", SERIES_ID);

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
  if (cutOnly) {
    if (!isValidSceneTakePlan(existingShots)) {
      throw new Error("cut-only needs the current 4–6 scene-take plan");
    }
    if (existingShots.some((shot) => shot.status !== "complete" || !shot.selected_generation_id)) {
      throw new Error("cut-only needs every take complete");
    }
  }
  const keepPlan = resume && seriesRow.title === TITLE && isValidSceneTakePlan(existingShots);

  if (!keepPlan) {
    const bible = patchBible((seriesRow.story_bible as StoryBible | null) ?? existing.store.series.get(SERIES_ID)?.story_bible);
    await client
      .from("series")
      .update({
        title: TITLE,
        description: IDEA,
        story_bible: bible,
        style_profile: { episode_length: "60_90" },
        updated_at: new Date().toISOString(),
      })
      .eq("id", SERIES_ID);
    await client
      .from("episodes")
      .update({
        title: "The Man on the Floor",
        status: "draft",
        script: "",
        episode_outline: null,
        render_manifest: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", EPISODE_ID);
    const { data: scenes } = await client.from("scenes").select("id").eq("episode_id", EPISODE_ID);
    if (scenes?.length) {
      const { error } = await client.from("scenes").delete().in(
        "id",
        scenes.map((row) => row.id),
      );
      if (error) throw new Error(error.message);
    }
  }

  const loaded = keepPlan ? existing : await loadSeriesStore(client, SERIES_ID);
  const assets = keepPlan ? existingAssets : createConfiguredAssetStore();
  if (!keepPlan) hydrateAssetStore(assets, loaded.assets);
  // Characters carry the bible's job into refs, prompts, and the on-screen intro label.
  for (const character of loaded.store.charactersFor(SERIES_ID)) {
    const key = character.name.trim().toUpperCase().split(/\s+/)[0] ?? "";
    const description = CAST_JOBS[key];
    if (description && character.description !== description) {
      loaded.store.characters.set(character.id, { ...character, description });
    }
  }
  const liveSeries = loaded.store.series.get(SERIES_ID);
  if (liveSeries) {
    loaded.store.series.set(SERIES_ID, {
      ...liveSeries,
      title: TITLE,
      description: IDEA,
      story_bible: patchBible(liveSeries.story_bible) ?? liveSeries.story_bible,
      style_profile: { ...liveSeries.style_profile, episode_length: "60_90" },
    });
  }
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
    process.stdout.write("planning full-length scene-take episode 1…\n");
    const planned = await engine.planEpisode({
      owner_id: ownerId,
      episode_id: EPISODE_ID,
      episode_length: "60_90",
    });
    shots = [...planned.scenes]
      .sort((a, b) => a.position - b.position)
      .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
  } else {
    process.stdout.write("resuming existing scene-take plan…\n");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        title: TITLE,
        shotCount: shots.length,
        sceneTakes: shots.filter((shot) => isSceneTake(shot.shot_data)).length,
        seconds: shots.reduce((acc, shot) => acc + shot.shot_data.duration_hint_seconds, 0),
        takes: shots.map((shot) => ({
          fn: shot.shot_data.function,
          dur: shot.shot_data.duration_hint_seconds,
          dlg: shot.shot_data.dialogue,
          lines: (shot.shot_data.scene_script ?? "").split("\n").filter(Boolean).length,
          left: shot.shot_data.blocking?.camera_left ?? null,
          right: shot.shot_data.blocking?.camera_right ?? null,
          prop: shot.shot_data.blocking?.prop ?? null,
          coverage: shot.shot_data.blocking?.coverage ?? null,
          pictured: shot.shot_data.blocking?.pictured ?? null,
          camera: shot.shot_data.camera,
        })),
      },
      null,
      2,
    )}\n`,
  );
  if (!isValidSceneTakePlan(shots)) {
    throw new Error(`Plan is not 4–6 scene takes (${shots.length} shots)`);
  }
  if (!isCourierPlan(shots)) {
    throw new Error("Plan is not the laundromat rescue (or reused carrier/Tuesday leftovers). Refusing to spend Seedance on it.");
  }
  if (!hasCoverageMix(shots)) {
    throw new Error("Plan is missing locked sides or drifted into singles. Refusing to spend Seedance.");
  }
  if (!hasConversation(shots)) {
    throw new Error("Plan is trailer-thin. Need 4+ spoken cues in every take.");
  }

  const commit = async () => {
    await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? existing.assets);
  };
  await commit();

  if (cutOnly) {
    process.stdout.write("cutting existing complete takes…\n");
  }

  for (const [index, shot] of cutOnly ? [] : shots.entries()) {
    process.stdout.write(
      `shoot ${index + 1}/${shots.length} ${shot.shot_data.function} ${shot.shot_data.duration_hint_seconds}s ${shot.shot_data.dialogue ?? ""}\n`,
    );
    const started = Date.now();
    let extraAttempts = 0;
    while (Date.now() - started < 50 * 60 * 1000) {
      enqueueActiveVideo(engine, shots);
      await engine.tick();
      await commit();
      const live = engine.store.shots.get(shot.id);
      if (live?.status === "complete") {
        const takeId = live.selected_generation_id;
        if (takeId) {
          const take = await assets.get(takeId).catch(() => null);
          if (take) {
            await mkdir(OUT, { recursive: true });
            const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
            await writeFile(resolve(OUT, name), take.body);
            process.stdout.write(`  wrote ${name} ${take.body.byteLength} bytes\n`);
          }
        }
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
      const usable = live ? bestUsableTake(engine.store, live) : null;
      if (live && usable && canKeepSceneTake(usable) && (live.status === "needs_review" || live.status === "planned" || live.status === "generating")) {
        process.stdout.write(`  approving ${usable.assetId} (score ${usable.score}, blockers ${usable.blockers.join(",") || "none"})\n`);
        await engine.reviewTake({
          owner_id: ownerId,
          shot_id: shot.id,
          asset_id: usable.assetId,
          decision: "approve",
          note: "keep the full-length Seedance scene take",
        });
        await commit();
        continue;
      }
      if (usable && !canKeepSceneTake(usable)) {
        process.stdout.write(`  take ${usable.assetId} blocked (${usable.blockers.join(",")}); shooting another\n`);
      }
      if (!inflight && extraAttempts < 3 && live?.status !== "complete" && (!usable || !canKeepSceneTake(usable))) {
        extraAttempts += 1;
        process.stdout.write(`  ${live?.status ?? "missing"} ${shot.id} — generating (attempt ${extraAttempts}/3)\n`);
        try {
          const { job } = await engine.generateVideo({ owner_id: ownerId, shot_id: shot.id, quality: "maximum" });
          process.stdout.write(`  job ${job.id} ${job.model} $${job.estimated_cost ?? "?"} ${String(job.request_metadata.reason ?? "")}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (paymentFailed(message)) throw new Error(`Stopped on 402: ${message}`);
          const transient = /HTTP 500|HTTP 502|HTTP 503|HTTP 504|Internal Server Error|fetch failed|ECONNRESET|ETIMEDOUT|timed out|resource download failed|not valid: resource/i.test(message);
          if (transient && extraAttempts < 4) {
            process.stdout.write(`  transient submit, will retry (${extraAttempts}/3)\n`);
            await sleep(12_000);
            continue;
          }
          throw error;
        }
        await commit();
      }
      await sleep(8000);
    }
    const done = engine.store.shots.get(shot.id);
    if (done?.status !== "complete") {
      throw new Error(`Shot ${shot.id} ended ${done?.status ?? "missing"}`);
    }
  }

  process.stdout.write("cutting episode 1 from full takes…\n");
  const rendered = await engine.renderEpisode({ owner_id: ownerId, episode_id: EPISODE_ID });
  await commit();

  await mkdir(OUT, { recursive: true });
  const files: string[] = [];
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, shot] of orderedShots(engine, EPISODE_ID).entries()) {
    const takeId = shot.selected_generation_id;
    if (!takeId) continue;
    const take = await assets.get(takeId).catch(() => null);
    if (!take) continue;
    const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
    await writeFile(resolve(OUT, name), take.body);
    files.push(name);
    rows.push({
      file: name,
      function: shot.shot_data.function,
      duration: shot.shot_data.duration_hint_seconds,
      dialogue: shot.shot_data.dialogue,
      script: shot.shot_data.scene_script,
    });
  }
  if (rendered.asset) {
    const finalBytes = await assets.get(rendered.asset.id).catch(() => null);
    if (finalBytes) {
      await writeFile(resolve(OUT, "ep1-one-minute.mp4"), finalBytes.body);
      files.push("ep1-one-minute.mp4");
    }
  }
  await writeFile(
    resolve(OUT, "LIST.txt"),
    [
      "Boss Marries the Delivery Driver Girl — episode 1. In-generation cuts, hard joins, one flash at the cliff. Not mixed with earlier ep1-* folders.",
      `Title: ${TITLE}`,
      `Folder: ${OUT}`,
      `Watch in order: ${files.filter((name) => name.startsWith("scene-")).join(" ")}`,
      "",
      ...rows.map((row, index) => `${index + 1}. ${row.file}\n   ${row.function} ${row.duration}s\n   ${row.dialogue ?? ""}\n`),
    ].join("\n"),
  );
  await writeFile(resolve(OUT, "LIST.json"), JSON.stringify({ title: TITLE, logline: LOGLINE, rows }, null, 2));
  process.stdout.write(`READY · ${rows.length} scenes + ${resolve(OUT, "ep1-one-minute.mp4")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
