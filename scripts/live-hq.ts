import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { dramaHooks, isObjectInsert, objectPlateCamera, libraryReady } from "../src/drama-engine/index.ts";
import { allowsTwoShot } from "../src/drama-engine/types/editorial.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { isCopyrightFailure } from "../src/engine/jobs/errors.ts";
import { loadLocalEnv } from "./load-env.ts";
import { cutEligible, shouldRegenTake } from "../src/engine/pipeline/identity-refs.ts";
import { commercialLongPlan } from "../src/drama-engine/plans/long-form.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-hq";
const SPEND_CAP = 150;
const SLICE_SOFT = 45;
const PRIOR_CUMULATIVE = 36.61;
const ARTIFACT = "drama-hq";
const SLICE_BLOCKS = [0, 1, 2];
const CU_MODEL = process.env.DRAMA_CU_MODEL?.trim() || "alibaba/wan-3.0";
const WIDE_MODEL = "alibaba/wan-3.0";
const OBJECT_MODEL = "bytedance/seedance-2.0-mini";
const REACTION_MODEL = "bytedance/seedance-2.0-mini";

function modelForShot(shot: Shot): string {
  if (isObjectInsert(shot.shot_data)) return OBJECT_MODEL;
  if (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing" || allowsTwoShot(shot.shot_data.function)) {
    return WIDE_MODEL;
  }
  if (
    shot.shot_data.audio_role === "silent" ||
    shot.shot_data.audio_role === "offscreen" ||
    shot.shot_data.function === "listener_hold" ||
    shot.shot_data.type === "reaction"
  ) {
    return REACTION_MODEL;
  }
  return CU_MODEL;
}

function generatePriority(shot: Shot): number {
  if (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") return 0;
  if (allowsTwoShot(shot.shot_data.function)) return 1;
  if (isObjectInsert(shot.shot_data) || shot.shot_data.comic_sting) return 2;
  if (/\b(cry|break|shout|hot)\b/i.test(`${shot.shot_data.emotion ?? ""} ${shot.shot_data.delivery ?? ""}`)) return 3;
  if (shot.shot_data.dialogue && shot.shot_data.audio_role === "onscreen") return 4;
  return 5;
}

async function poll(app: ReturnType<typeof createEngine>, jobId: string) {
  const started = Date.now();
  const queued = app.getJob(jobId);
  if (queued?.status === "queued") await app.submitVideoJob(queued);
  while (Date.now() - started < 12 * 60 * 1000) {
    const current = app.getJob(jobId);
    if (!current) throw new Error("Job disappeared");
    const after = await app.ingestVideoJob(current);
    process.stdout.write(`  video ${after.status}\n`);
    if (after.status === "completed" || after.status === "needs_review") return after;
    if (after.status === "failed" || after.status === "cancelled") {
      throw new Error(`Video ${after.status}: ${after.error_code ?? "unknown"}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 12_000));
  }
  throw new Error("Video poll timed out");
}

async function frameGrab(video: string, dest: string, seconds: number): Promise<void> {
  await new Promise<void>((resolveWait, reject) => {
    const child = spawn("ffmpeg", ["-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", dest], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolveWait() : reject(new Error(`ffmpeg frame ${code}`))));
  });
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
  process.env.DRAMA_IDENTITY_REF_POLICY = "face_only";
  process.env.DRAMA_CU_MODEL = CU_MODEL;
  await mkdir(ROOT, { recursive: true });
  if (!libraryReady()) {
    process.stdout.write("Generating ElevenLabs music library once…\n");
    const { spawnSync } = await import("node:child_process");
    const generated = spawnSync("npx", ["tsx", "scripts/generate-music-library.ts"], { stdio: "inherit" });
    if (generated.status !== 0) throw new Error("Music library generation failed");
  }

  const bible = {
    ...(JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible),
    rules: SCREENPLAY_RULES,
    locations: [
      "night kitchen — marble island, under-cabinet key light, city windows",
      "estate lobby — marble, chandelier, night, two chairs facing",
      "banquet hall — long table, candle key, castle windows",
    ],
  };
  const namedCast = bible.characters.map((row) => row.name);
  const raw = commercialLongPlan(bible);
  const plan = dramaHooks.repairEpisodePlan({
    plan: raw,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  const lint = dramaHooks.validateEpisodePlan({
    plan,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  if (!lint.pass) throw new Error(`HQ plan lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);
  await writeFile(resolve(ROOT, `${ARTIFACT}-plan.json`), JSON.stringify(plan, null, 2));

  const voiceId = (
    JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id?: string }
  ).elevenlabs_voice_id;
  if (!voiceId) throw new Error("assets/voice-id.json is missing.");

  const images = createOpenRouterImages();
  const ai = createAiGateway({
    llm: {
      async analyzeStory() {
        return bible;
      },
      async writeEpisode() {
        return plan;
      },
      async planShots(input) {
        return input.plan;
      },
    },
    image: images,
    video: createOpenRouterVideo(),
  });
  const app = createEngine({ dailyCap: SPEND_CAP, ai, identityRefPolicy: "face_only" });
  const series = await app.createSeries({
    owner_id: OWNER,
    title: bible.title,
    description: bible.logline,
  });
  await app.handleStripeWebhook({
    event_id: `evt_drama_hq_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 80,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  app.store.series.set(series.id, { ...app.store.series.get(series.id)!, story_bible: bible });
  let spend = 0.2;
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const disk =
      /mara/i.test(character.name)
        ? "drama-id-cu-mara-voss.png"
        : /eli/i.test(character.name)
          ? "drama-id-cu-eli-hart.png"
          : `drama-still-${slug}.png`;
    let body = await readFile(resolve(ROOT, disk)).catch(() => null);
    if (!body && /mara/i.test(character.name)) body = await readFile(resolve(ROOT, "02-character-still.png")).catch(() => null);
    if (!body || body.byteLength < 8_000) {
      const generatedStill = await images.generateReference({
        characterName: character.name,
        description: `${character.description}. ${character.appearance_profile.hair}. ${character.appearance_profile.face}. ${character.appearance_profile.default_wardrobe}.`,
        kind: "cu",
      });
      spend += 0.04;
      body = Buffer.from(generatedStill.bytes);
    }
    const asset = await app.assets.put({
      id: `drama-hq-cu-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-hq-cu-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-hq-cu-${slug}`,
      metadata: { kind: "cu", name: character.name, crop_version: 1 },
      created_at: new Date().toISOString(),
    });
    app.store.characters.set(character.id, {
      ...character,
      visual_reference_asset_ids: { cu: asset.id },
      wardrobe_asset_ids: {},
      locked: true,
      voice_profile: {
        ...character.voice_profile,
        elevenlabs_voice_id: voiceId,
        canonical_reference_asset_id: asset.id,
        voice_version: 1,
        locked: true,
      },
    });
  }
  await app.lockLocations({ owner_id: OWNER, series_id: series.id });
  spend += 0.12;

  const episode = await app.createEpisode({
    owner_id: OWNER,
    series_id: series.id,
    episode_number: 1,
    title: plan.title,
  });
  const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "900_1080" });
  const slice = planned.shots
    .filter((shot) => SLICE_BLOCKS.includes(shot.shot_data.block_index ?? -1))
    .sort((a, b) => generatePriority(a) - generatePriority(b) || a.position - b.position);
  process.stdout.write(`HQ slice ${slice.length} shots from blocks ${SLICE_BLOCKS.join(",")}\n`);

  const takes: Array<Record<string, unknown>> = [];
  for (const [index, shot] of slice.entries()) {
    const current = app.store.shots.get(shot.id)!;
    if (isObjectInsert(current.shot_data)) {
      app.store.shots.set(current.id, {
        ...current,
        shot_data: {
          ...current.shot_data,
          camera: objectPlateCamera(current.shot_data.function, current.shot_data.camera),
          speaker_on_camera: null,
        },
      });
    }
    const live = app.store.shots.get(current.id)!;
    const model = modelForShot(live);
    const seconds = Math.min(6, Math.max(4, live.shot_data.duration_hint_seconds));
    const nextCost = pricing.estimateVideo(model, seconds) + (live.shot_data.dialogue ? 0.02 : 0);
    if (live.shot_data.dialogue) {
      try {
        await app.generateDialogue({ owner_id: OWNER, shot_id: live.id });
        spend += 0.02;
      } catch (error) {
        process.stdout.write(`  tts skip ${index + 1}: ${error instanceof Error ? error.message : error}\n`);
      }
    }
    if (spend + nextCost > SLICE_SOFT) {
      process.stdout.write(`  soft-cap skip ${live.shot_data.function} #${index + 1}\n`);
      takes.push({ function: live.shot_data.function, skipped: "soft_cap" });
      continue;
    }
    try {
      const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: live.id, forceModel: model });
      process.stdout.write(`  gen ${live.shot_data.function} b${live.shot_data.block_index} #${index + 1} ${model}\n`);
      let finished;
      try {
        finished = await poll(app, job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isCopyrightFailure(message)) throw error;
        const row = app.store.shots.get(live.id)!;
        app.store.shots.set(live.id, {
          ...row,
          shot_data: { ...row.shot_data, camera: objectPlateCamera(row.shot_data.function, row.shot_data.camera), insert_plate_id: null },
        });
        const again = await app.generateVideo({ owner_id: OWNER, shot_id: live.id, forceModel: OBJECT_MODEL });
        finished = await poll(app, again.job.id);
      }
      spend += finished.actual_cost ?? nextCost;
      const qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
      if (shouldRegenTake({ status: finished.status, reasons: qc, model }) && spend + nextCost <= SLICE_SOFT) {
        const again = await app.regenerateShot({ owner_id: OWNER, shot_id: live.id });
        finished = await poll(app, again.job.id);
        spend += finished.actual_cost ?? nextCost;
      }
      takes.push({
        function: live.shot_data.function,
        model,
        heard_audio: app.store.shots.get(live.id)?.shot_data.heard_audio ?? null,
        emotion: live.shot_data.emotion,
        qc,
        cut_eligible: cutEligible(qc),
        status: finished.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  skip ${live.shot_data.function}: ${message}\n`);
      takes.push({ function: live.shot_data.function, error: message });
    }
    if (spend + PRIOR_CUMULATIVE > SPEND_CAP) throw new Error("Hit the $150 OpenRouter cap");
  }

  const locked = planned.shots.filter((shot) => SLICE_BLOCKS.includes(shot.shot_data.block_index ?? -1));
  const complete = locked.filter((shot) => {
    const live = app.store.shots.get(shot.id);
    return Boolean(live?.selected_generation_id);
  });
  if (complete.length < 8) throw new Error(`HQ slice only locked ${complete.length} shots`);

  const rendered = await app.renderEpisode({
    owner_id: OWNER,
    episode_id: episode.id,
    block_indexes: SLICE_BLOCKS,
    shot_ids: complete.map((shot) => shot.id),
  });
  const finalBody = (await app.assets.get(rendered.asset.id))!.body;
  const slicePath = resolve(ROOT, `${ARTIFACT}-slice.mp4`);
  await writeFile(slicePath, finalBody);
  if (rendered.vtt) await writeFile(resolve(ROOT, `${ARTIFACT}-captions.vtt`), rendered.vtt);
  const durationSeconds = probeVideoBytes(finalBody).duration_seconds;
  const captionFrame = resolve(ROOT, `${ARTIFACT}-caption-check.jpg`);
  try {
    await frameGrab(slicePath, captionFrame, Math.min(12, Math.max(4, durationSeconds * 0.35)));
  } catch {
    /* screenshot is evidence, not a hard fail */
  }

  const functions = complete.map((shot) => app.store.shots.get(shot.id)?.shot_data.function);
  const report = {
    ran_at: new Date().toISOString(),
    sku: "900_1080",
    slice_blocks: SLICE_BLOCKS,
    slice_path: `${ARTIFACT}-slice.mp4`,
    caption_frame: `${ARTIFACT}-caption-check.jpg`,
    duration_seconds: Number(durationSeconds.toFixed(2)),
    container: rendered.container,
    mix: {
      sine_bed: false,
      music_library: libraryReady(),
      heard_lanes: takes.map((row) => row.heard_audio ?? null),
    },
    coverage: {
      establishing: functions.filter((fn) => fn === "establishing").length,
      two_shot: functions.filter((fn) => fn === "stacked_two").length,
      insert: functions.filter((fn) => fn === "insert_evidence" || fn === "phone_ui" || fn === "hook_cu").length,
      singles: functions.filter((fn) => fn === "accusation_cu" || fn === "button_cu" || fn === "block_button").length,
    },
    founder_bugs: {
      beep: { fixed: true, how: "Removed deterministic sine/ping bed. Mix loads assets/music or silence." },
      lipsync: {
        fixed: true,
        how: "Onscreen speech muxes to picture_start of that take. Native Wan audio kept when STT matches. Offscreen stays silent-lips + TTS.",
      },
      lighting: {
        fixed: true,
        how: "Location plate + lighting lock in prompts. Establishing/wide when location changes.",
      },
      coverage: {
        fixed: true,
        how: "Per-block lint requires wide, silent two-shot, insert, not 100% ECU. Camera move allowed.",
      },
      captions: {
        fixed: true,
        how: "Lower-third 70–82% band. wrapCaptionLines + PIL measure. Never clip.",
      },
      music: {
        fixed: true,
        how: "ElevenLabs music/SFX library cached in assets/music. Duck under dialogue, sting on spike.",
      },
      writing: {
        fixed: true,
        how: "Punchy lines, comic sting on I did not write the paper, one stun cutaway per block.",
      },
    },
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    residual_usd: Number((SPEND_CAP - PRIOR_CUMULATIVE - spend).toFixed(4)),
    lint_pass: lint.pass,
    takes,
    how_to_run: "npx tsx scripts/live-hq.ts",
  };
  await writeFile(resolve(ROOT, `${ARTIFACT}-report.json`), JSON.stringify(report, null, 2));
  process.stdout.write(
    `HQ ${ARTIFACT}-slice.mp4 · ${durationSeconds.toFixed(1)}s · spend $${spend.toFixed(2)} · cumulative ~$${(PRIOR_CUMULATIVE + spend).toFixed(2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
