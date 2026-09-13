/**
 * Replan episode 1 on the micro-drama engine, shoot unique generation shots
 * locally, write each as its own file, then concat a 60s cut.
 *
 * Does not queue hosted engine_tasks.
 *
 *   npx tsx scripts/shoot-ep1-micro.ts
 *   npx tsx scripts/shoot-ep1-micro.ts --resume
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine, DuplicateSceneTakeError } from "../src/engine/create-engine.ts";
import { isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { channelOf } from "../src/drama-engine/types/micro-drama.ts";
import { sceneTakesShareSpokenBeat } from "../src/drama-engine/types/dialogue.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import { validateEpisodePlan } from "../src/drama-engine/lint/validate-plan.ts";
import type { GenerationJob, Shot } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";
const OUT = resolve(process.cwd(), "assets", "live", "ep1-micro");
const TARGET_SECONDS = 60;

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}`))));
  });
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
    id: `micro-${job.id}`,
    job_id: job.id,
    kind: "generate",
    created_at: job.created_at,
    visible_at: new Date().toISOString(),
  });
}

function spokenKey(shot: Shot): string {
  return (shot.shot_data.dialogue ?? "").trim().toLowerCase();
}

function isDuplicateSpoken(shot: Shot, earlier: Shot[]): boolean {
  const line = spokenKey(shot);
  if (!line) return false;
  return earlier.some((row) => spokenKey(row) === line || sceneTakesShareSpokenBeat(row.shot_data, shot.shot_data));
}

function paymentFailed(message: string): boolean {
  return /\b402\b/.test(message) || /insufficient|credits|payment required/i.test(message);
}

async function waitForJob(
  engine: ReturnType<typeof createEngine>,
  jobId: string,
  commit: () => Promise<void>,
): Promise<GenerationJob> {
  const started = Date.now();
  while (Date.now() - started < 50 * 60 * 1000) {
    const live = engine.store.jobs.get(jobId);
    if (!live) throw new Error(`Job ${jobId} disappeared`);
    enqueueJob(engine, live);
    await engine.tick();
    await commit();
    const next = engine.store.jobs.get(jobId)!;
    if (next.status === "completed" || next.status === "needs_review") return next;
    if (next.status === "failed" || next.status === "cancelled") {
      throw new Error(`Job ${jobId} ${next.status}: ${next.error_code ?? next.result_metadata.submit_error ?? ""}`);
    }
    await sleep(8000);
  }
  throw new Error(`Job ${jobId} timed out`);
}

function hasAudioStream(file: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      file,
    ]);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => resolvePromise(false));
    child.on("exit", () => resolvePromise(out.trim().length > 0));
  });
}

async function concatMinute(files: string[], outFile: string, usedEach: number) {
  const normalized: string[] = [];
  const dur = usedEach.toFixed(3);
  for (const [index, file] of files.entries()) {
    const next = resolve(OUT, `._norm-${String(index + 1).padStart(2, "0")}.mp4`);
    const audio = await hasAudioStream(file);
    const filter = audio
      ? `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,trim=0:${dur},setpts=PTS-STARTPTS[v];[0:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur},asetpts=PTS-STARTPTS[a]`
      : `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,trim=0:${dur},setpts=PTS-STARTPTS[v];[1:a]atrim=0:${dur},asetpts=PTS-STARTPTS[a]`;
    await run("ffmpeg", [
      "-y",
      "-i",
      file,
      ...(audio ? [] : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]),
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-pix_fmt",
      "yuv420p",
      "-t",
      dur,
      next,
    ]);
    normalized.push(next);
  }
  const listPath = resolve(OUT, "._concat.txt");
  await writeFile(listPath, normalized.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outFile,
  ]);
}

async function main() {
  loadLocalEnv();
  const resume = process.argv.includes("--resume");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: series } = await client.from("series").select("owner_id").eq("id", SERIES_ID).single();
  if (!series) throw new Error("Series not found");
  const ownerId = series.owner_id;

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for local micro-drama ep1 shoot" })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);
  await client
    .from("productions")
    .update({
      paused: true,
      status: "needs_user",
      agent_decision: "Paused so episode 1 can shoot locally on the micro-drama engine.",
      updated_at: new Date().toISOString(),
    })
    .eq("series_id", SERIES_ID);

  const existing = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, existing.assets);
  let engine = createEngine({
    store: existing.store,
    assets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
  });
  engine.store.queue = [];

  let shots = orderedShots(engine, EPISODE_ID);
  const keep =
    resume &&
    shots.length >= 15 &&
    shots.length <= 25 &&
    shots.every((shot) => !isSceneTake(shot.shot_data));

  if (!keep) {
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

    const reloaded = await loadSeriesStore(client, SERIES_ID);
    hydrateAssetStore(assets, reloaded.assets);
    const fresh = createEngine({
      store: reloaded.store,
      assets,
      skipSeriesBudget: true,
      ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    });
    fresh.store.queue = [];
    process.stdout.write("planning micro-drama episode 1…\n");
    const planned = await fresh.planEpisode({
      owner_id: ownerId,
      episode_id: EPISODE_ID,
      episode_length: "60_90",
    });
    shots = [...planned.scenes]
      .sort((a, b) => a.position - b.position)
      .flatMap((scene) => fresh.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
    engine = fresh;
  } else {
    process.stdout.write("resuming existing micro-drama plan…\n");
  }

  const namedCast = engine.store.charactersFor(SERIES_ID).map((character) => character.name);
  const plan = {
    title: engine.store.episodes.get(EPISODE_ID)?.title ?? "Episode 1",
    hook: shots[0]?.shot_data.dialogue ?? "",
    conflict: "",
    cliffhanger: shots.at(-1)?.shot_data.dialogue ?? "",
    scenes: engine.store.scenesFor(EPISODE_ID).sort((a, b) => a.position - b.position).map((scene) => ({
      location: scene.location,
      time: scene.scene_data.time ?? "night",
      characters: scene.scene_data.characters ?? [],
      shots: engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position).map((shot) => shot.shot_data),
    })),
  };
  const lint = validateEpisodePlan({ plan, namedCast, length: "60_90", episodeNumber: 1 });
  process.stdout.write(
    JSON.stringify(
      {
        shotCount: shots.length,
        sceneTakes: shots.filter((shot) => isSceneTake(shot.shot_data)).length,
        channels: {
          sync: shots.filter((shot) => channelOf(shot.shot_data) === "sync").length,
          vo: shots.filter((shot) => channelOf(shot.shot_data) === "vo").length,
          silent: shots.filter((shot) => channelOf(shot.shot_data) === "silent").length,
        },
        lintPass: lint.pass,
        blocking: lint.blocking.map((row) => row.id),
      },
      null,
      2,
    ) + "\n",
  );
  if (shots.length < 15 || shots.length > 25 || shots.some((shot) => isSceneTake(shot.shot_data))) {
    throw new Error(`Plan is not a 15–25 shot micro-drama (${shots.length} shots)`);
  }
  if (!lint.pass) {
    throw new Error(`Plan failed lint: ${lint.blocking.map((row) => row.id).join(", ")}`);
  }

  const unique: Shot[] = [];
  const skipped: string[] = [];
  for (const shot of shots) {
    if (isDuplicateSpoken(shot, unique)) {
      skipped.push(shot.id);
      continue;
    }
    unique.push(shot);
  }
  if (unique.length < 8) {
    throw new Error(`After dropping doubled spoken beats, ${unique.length} shots remain`);
  }

  await mkdir(OUT, { recursive: true });
  const commit = async () => {
    await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? existing.assets);
  };
  await commit();

  const rows: Array<Record<string, unknown>> = [];
  const files: string[] = [];

  for (const [index, shot] of unique.entries()) {
    const name = `${String(index + 1).padStart(2, "0")}.mp4`;
    const dest = resolve(OUT, name);
    process.stdout.write(`shoot ${index + 1}/${unique.length} ${shot.shot_data.function} ${channelOf(shot.shot_data)} ${shot.shot_data.dialogue ?? "(silent)"}\n`);

    const already = engine.store.shots.get(shot.id);
    const selected = already?.selected_generation_id;
    if (resume && selected) {
      const stored = await assets.get(selected);
      if (stored) {
        await writeFile(dest, stored.body);
        files.push(dest);
        rows.push({
          file: name,
          shot_id: shot.id,
          reused: selected,
          function: shot.shot_data.function,
          channel: channelOf(shot.shot_data),
          dialogue: shot.shot_data.dialogue,
        });
        process.stdout.write(`  reused ${selected}\n`);
        continue;
      }
    }

    engine.store.shots.set(shot.id, {
      ...shot,
      status: "planned",
      selected_generation_id: null,
      shot_data: { ...shot.shot_data, heard_audio: channelOf(shot.shot_data) === "sync" ? "native" : shot.shot_data.heard_audio, take_reviews: [] },
    });
    for (const job of engine.store.jobs.values()) {
      if (job.shot_id !== shot.id || job.job_type !== "video") continue;
      if (job.status === "queued" || job.status === "generating" || job.status === "submitting") {
        engine.store.jobs.set(job.id, { ...job, status: "cancelled" });
      }
    }
    engine.store.queue = [];

    let live: GenerationJob | null = null;
    for (let attempt = 1; attempt <= 3 && !live; attempt += 1) {
      const currentLine = engine.store.shots.get(shot.id)?.shot_data.dialogue ?? shot.shot_data.dialogue;
      const words = (currentLine ?? "").trim().split(/\s+/).filter(Boolean);
      if (currentLine && (attempt > 1 || words.length < 3)) {
        const punched = words.length < 3 ? "That date is Tuesday. Say it." : `${currentLine.replace(/[.!?]+$/, "")} now.`;
        engine.store.shots.set(shot.id, {
          ...engine.store.shots.get(shot.id)!,
          shot_data: { ...engine.store.shots.get(shot.id)!.shot_data, dialogue: punched.slice(0, 80) },
        });
      }
      let job: GenerationJob;
      try {
        const submitted = await engine.generateVideo({
          owner_id: ownerId,
          shot_id: shot.id,
          quality: "maximum",
        });
        job = submitted.job;
        process.stdout.write(`  job ${job.id} ${job.model} $${job.estimated_cost ?? "?"} ${String(job.request_metadata.reason ?? "")}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof DuplicateSceneTakeError || /already speaks the same beat/i.test(message)) {
          process.stdout.write(`  skip doubled beat ${shot.id}\n`);
          skipped.push(shot.id);
          live = null;
          break;
        }
        if (paymentFailed(message)) throw new Error(`Stopped on 402: ${message}`);
        if (attempt === 3) throw error;
        process.stdout.write(`  submit failed (${attempt}/3): ${message.slice(0, 160)}\n`);
        continue;
      }
      try {
        live = await waitForJob(engine, job.id, commit);
        if (paymentFailed(String(live.error_code ?? ""))) {
          throw new Error(`Stopped on 402: ${live.error_code}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (paymentFailed(message)) throw new Error(`Stopped on 402: ${message}`);
        if (attempt === 3) throw error;
        process.stdout.write(`  take failed (${attempt}/3): ${message.slice(0, 180)}\n`);
        live = null;
      }
    }
    if (!live) continue;
    if (paymentFailed(String(live.error_code ?? ""))) {
      throw new Error(`Stopped on 402: ${live.error_code}`);
    }
    const assetId = typeof live.result_metadata.asset_id === "string" ? live.result_metadata.asset_id : null;
    if (!assetId) throw new Error(`Job ${live.id} ended ${live.status} with no asset`);
    const stored = await assets.get(assetId);
    if (!stored) throw new Error(`Missing bytes for ${assetId}`);
    await writeFile(dest, stored.body);
    files.push(dest);
    rows.push({
      file: name,
      bytes: stored.body.byteLength,
      shot_id: shot.id,
      job_id: live.id,
      asset_id: assetId,
      model: live.model,
      cost: live.actual_cost ?? live.estimated_cost,
      function: shot.shot_data.function,
      channel: channelOf(shot.shot_data),
      dialogue: shot.shot_data.dialogue,
      reason: live.request_metadata.reason,
    });
    process.stdout.write(`  wrote ${name} ${stored.body.byteLength} bytes\n`);
  }

  if (files.length < 8) throw new Error(`Only ${files.length} takes landed; will not cut a short dump`);
  const usedEach = Math.min(4, Math.max(1.5, TARGET_SECONDS / files.length));
  const finalPath = resolve(OUT, "ep1-one-minute.mp4");
  process.stdout.write(`cutting ${files.length} takes × ${usedEach.toFixed(2)}s → ${finalPath}\n`);
  await concatMinute(files, finalPath, usedEach);

  const list = [
    "Episode 1 micro-drama. New engine. New takes. Not mixed with ep1-raw.",
    `Folder: ${OUT}`,
    `Shots written: ${files.length}`,
    `Skipped doubled beats: ${skipped.length}`,
    `Used picture per shot: ${usedEach.toFixed(2)}s`,
    `Full cut: ep1-one-minute.mp4`,
    "",
    ...rows.map((row, index) =>
      [
        `${index + 1}. ${row.file}`,
        `   channel: ${row.channel}`,
        `   function: ${row.function}`,
        `   model: ${row.model ?? "reused"}`,
        `   line: ${row.dialogue ?? ""}`,
        "",
      ].join("\n"),
    ),
  ].join("\n");
  await writeFile(resolve(OUT, "LIST.txt"), list);
  await writeFile(resolve(OUT, "LIST.json"), JSON.stringify({ skipped, rows }, null, 2));
  await commit();
  process.stdout.write(`READY · ${files.length} scenes + ${finalPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
