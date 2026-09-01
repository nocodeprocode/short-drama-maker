import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { dramaHooks, isObjectInsert, kitchenLockPlan, libraryReady } from "../src/drama-engine/index.ts";
import { allowsTwoShot } from "../src/drama-engine/types/editorial.ts";
import { identityDrifted, meanRgb } from "../src/engine/media/identity-drift.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { cutEligible, shouldRegenTake } from "../src/engine/pipeline/identity-refs.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { loadLocalEnv } from "./load-env.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-lock";
const SPEND_CAP = 150;
const SLICE_SOFT = 35;
const PRIOR_CUMULATIVE = 48.84;
const ARTIFACT = "drama-lock";
const CU_MODEL = process.env.DRAMA_CU_MODEL?.trim() || "alibaba/wan-3.0";
const OBJECT_MODEL = "bytedance/seedance-2.0-mini";

function modelForShot(shot: Shot): string {
  if (isObjectInsert(shot.shot_data) || shot.shot_data.function === "establishing") return OBJECT_MODEL;
  return CU_MODEL;
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

async function stillHold(png: Uint8Array, name: string, dest: string): Promise<Uint8Array> {
  const dir = resolve(ROOT, "lock-tmp");
  await mkdir(dir, { recursive: true });
  const still = resolve(dir, `${name.replace(/\s+/g, "-").toLowerCase()}.png`);
  const labeled = resolve(dir, `${name.replace(/\s+/g, "-").toLowerCase()}-card.png`);
  await writeFile(still, png);
  const py = `
from PIL import Image, ImageDraw, ImageFont
im = Image.open(${JSON.stringify(still)}).convert("RGB")
im = im.resize((720, 1280))
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 44)
except Exception:
    font = ImageFont.load_default()
text = ${JSON.stringify(name.toUpperCase())}
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (720 - tw) / 2
y = 1280 * 0.76
for dx, dy in ((-3,0),(3,0),(0,-3),(0,3)):
    d.text((x+dx, y+dy), text, font=font, fill=(0,0,0))
d.text((x, y), text, font=font, fill=(255,255,255))
im.save(${JSON.stringify(labeled)})
`;
  const script = resolve(dir, "label.py");
  await writeFile(script, py);
  spawnSync("python3", [script], { stdio: "ignore" });
  await new Promise<void>((resolveWait, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-y", "-loop", "1", "-i", labeled, "-t", "1.6", "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", dest],
      { stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolveWait() : reject(new Error(`still hold ${code}`))));
  });
  return new Uint8Array(await readFile(dest));
}

async function frameGrab(video: string, dest: string, seconds: number): Promise<void> {
  await new Promise<void>((resolveWait, reject) => {
    const child = spawn("ffmpeg", ["-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-update", "1", dest], {
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
  await mkdir(resolve(ROOT, "lock-frames"), { recursive: true });
  if (!libraryReady()) {
    const generated = spawnSync("npx", ["tsx", "scripts/generate-music-library.ts"], { stdio: "inherit" });
    if (generated.status !== 0) throw new Error("Music library generation failed");
  }

  const bible = {
    ...(JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible),
    rules: SCREENPLAY_RULES,
    locations: ["night kitchen — marble island, under-cabinet key light, city windows"],
  };
  const namedCast = bible.characters.map((row) => row.name);
  const lead = namedCast.find((name) => /mara/i.test(name)) ?? namedCast[0]!;
  const wall = namedCast.find((name) => /eli/i.test(name)) ?? namedCast[1]!;
  const witness = namedCast.find((name) => /jules/i.test(name)) ?? namedCast[2]!;
  const plan = kitchenLockPlan({ lead, wall, witness });
  const lint = dramaHooks.validateEpisodePlan({
    plan,
    bible,
    length: "60_90",
    namedCast,
    episodeNumber: 1,
  });
  if (!lint.pass) throw new Error(`Lock plan lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);
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
    event_id: `evt_drama_lock_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 25,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  app.store.series.set(series.id, { ...app.store.series.get(series.id)!, story_bible: bible });
  let spend = 0.2;
  const stillBytes = new Map<string, Uint8Array>();
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const disk =
      /mara/i.test(character.name)
        ? "drama-id-cu-mara-voss.png"
        : /eli/i.test(character.name)
          ? "drama-id-cu-eli-hart.png"
          : "drama-still-jules-renner.png";
    const body = await readFile(resolve(ROOT, disk));
    stillBytes.set(character.name, body);
    const asset = await app.assets.put({
      id: `drama-lock-cu-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-lock-cu-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-lock-cu-${slug}`,
      metadata: { kind: "cu", name: character.name, crop_version: "cu-28", locked: true },
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
  const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "60_90" });
  process.stdout.write(`Lock slice ${planned.shots.length} shots, kitchen only\n`);

  const takes: Array<Record<string, unknown>> = [];
  for (const [index, shot] of planned.shots.entries()) {
    const live = app.store.shots.get(shot.id)!;
    if (live.shot_data.function === "name_plant") {
      const who = live.shot_data.speaker_on_camera ?? live.shot_data.speaker ?? "CAST";
      const png = stillBytes.get(who) ?? [...stillBytes.values()][0]!;
      const dest = resolve(ROOT, "lock-tmp", `plant-${index}.mp4`);
      const body = await stillHold(png, who, dest);
      const asset = await app.assets.put({
        id: `lock-plant-${index}`,
        owner_id: OWNER,
        series_id: series.id,
        kind: "shot_video",
        bucket: "private-generation",
        storage_path: `private-generation/${series.id}/lock-plant-${index}.mp4`,
        mime_type: "video/mp4",
        body,
        checksum: `lock-plant-${index}`,
        metadata: { shot_id: live.id, name_plant: who, first_frame_asset_id: app.store.charactersFor(series.id).find((row) => row.name === who)?.visual_reference_asset_ids.cu },
        created_at: new Date().toISOString(),
      });
      app.store.shots.set(live.id, {
        ...live,
        status: "complete",
        selected_generation_id: asset.id,
        shot_data: {
          ...live.shot_data,
          first_frame_asset_id: typeof asset.metadata.first_frame_asset_id === "string" ? asset.metadata.first_frame_asset_id : null,
        },
      });
      process.stdout.write(`  plant ${who}\n`);
      takes.push({ function: "name_plant", speaker: who, status: "complete", first_frame: asset.metadata.first_frame_asset_id });
      continue;
    }
    if (allowsTwoShot(live.shot_data.function) && live.shot_data.function === "stacked_two" && !live.shot_data.group_still_asset_id) {
      process.stdout.write(`  skip stacked_two (no locked group still)\n`);
      app.store.shots.set(live.id, { ...live, shot_data: { ...live.shot_data, identity_reject: true } });
      takes.push({ function: live.shot_data.function, skipped: "no_group_still" });
      continue;
    }
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
      process.stdout.write(
        `  gen ${live.shot_data.function} ${live.shot_data.speaker_on_camera ?? live.shot_data.speaker ?? "obj"} #${index + 1} ${model} first_frame=${job.request_metadata.first_frame_asset_id ?? "none"} extra=${job.request_metadata.extra_ref_count ?? 0}\n`,
      );
      let finished = await poll(app, job.id);
      spend += finished.actual_cost ?? nextCost;
      let qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
      if (shouldRegenTake({ status: finished.status, reasons: qc, model }) && spend + nextCost <= SLICE_SOFT) {
        const again = await app.regenerateShot({ owner_id: OWNER, shot_id: live.id });
        finished = await poll(app, again.job.id);
        spend += finished.actual_cost ?? nextCost;
        qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
        if (!cutEligible(qc) && qc.includes("identity_drift")) {
          const row = app.store.shots.get(live.id)!;
          app.store.shots.set(live.id, {
            ...row,
            selected_generation_id: null,
            shot_data: { ...row.shot_data, identity_reject: true },
          });
          process.stdout.write(`  omit stranger ${live.shot_data.function}\n`);
          takes.push({ function: live.shot_data.function, omitted: "stranger" });
          continue;
        }
      }
      const pictured = live.shot_data.speaker_on_camera ?? live.shot_data.speaker;
      const takeId = app.store.shots.get(live.id)?.selected_generation_id;
      if (pictured && takeId && stillBytes.get(pictured)) {
        const take = await app.assets.get(takeId);
        const stillRgb = await meanRgb(stillBytes.get(pictured)!, "image");
        const frameRgb = take ? await meanRgb(take.body, "video") : null;
        if (stillRgb && frameRgb && identityDrifted(stillRgb, frameRgb, 140) && qc.includes("identity_drift")) {
          const row = app.store.shots.get(live.id)!;
          app.store.shots.set(live.id, {
            ...row,
            selected_generation_id: null,
            shot_data: { ...row.shot_data, identity_reject: true },
          });
          process.stdout.write(`  omit drifted ${pictured}\n`);
          takes.push({ function: live.shot_data.function, omitted: "identity_drift" });
          continue;
        }
      }
      takes.push({
        function: live.shot_data.function,
        speaker: pictured,
        model,
        first_frame_asset_id: app.store.shots.get(live.id)?.shot_data.first_frame_asset_id ?? job.request_metadata.first_frame_asset_id,
        extra_ref_count: job.request_metadata.extra_ref_count ?? 0,
        heard_audio: app.store.shots.get(live.id)?.shot_data.heard_audio ?? null,
        qc,
        status: finished.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  skip ${live.shot_data.function}: ${message}\n`);
      takes.push({ function: live.shot_data.function, error: message });
    }
    if (spend + PRIOR_CUMULATIVE > SPEND_CAP) throw new Error("Hit the $150 OpenRouter cap");
  }

  const playable = planned.shots.filter((shot) => {
    const live = app.store.shots.get(shot.id);
    return Boolean(live?.selected_generation_id) && !live?.shot_data.identity_reject;
  });
  if (playable.length < 5) throw new Error(`Lock slice only locked ${playable.length} shots`);

  const rendered = await app.renderEpisode({
    owner_id: OWNER,
    episode_id: episode.id,
    shot_ids: playable.map((shot) => shot.id),
  });
  const finalBody = (await app.assets.get(rendered.asset.id))!.body;
  const slicePath = resolve(ROOT, `${ARTIFACT}-slice.mp4`);
  await writeFile(slicePath, finalBody);
  if (rendered.vtt) await writeFile(resolve(ROOT, `${ARTIFACT}-captions.vtt`), rendered.vtt);
  const durationSeconds = probeVideoBytes(finalBody).duration_seconds;
  const captionTimes = [8, 22, 28];
  for (const t of captionTimes) {
    try {
      await frameGrab(slicePath, resolve(ROOT, "lock-frames", `${String(t).padStart(3, "0")}.jpg`), Math.min(t, durationSeconds - 0.2));
    } catch {
      /* evidence frames */
    }
  }
  try {
    await frameGrab(slicePath, resolve(ROOT, `${ARTIFACT}-caption-check.jpg`), Math.min(22, durationSeconds * 0.4));
  } catch {
    /* optional */
  }

  const report = {
    ran_at: new Date().toISOString(),
    slice_path: `${ARTIFACT}-slice.mp4`,
    duration_seconds: Number(durationSeconds.toFixed(2)),
    location: "kitchen night only",
    locked_stills: {
      mara: "drama-id-cu-mara-voss.png",
      eli: "drama-id-cu-eli-hart.png",
      jules: "drama-still-jules-renner.png",
    },
    vtt: rendered.vtt,
    mix: { sine_bed: false, music_library: libraryReady() },
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    residual_usd: Number((SPEND_CAP - PRIOR_CUMULATIVE - spend).toFixed(4)),
    lint_pass: lint.pass,
    takes,
    how_to_run: "npx tsx scripts/live-lock.ts",
  };
  await writeFile(resolve(ROOT, `${ARTIFACT}-report.json`), JSON.stringify(report, null, 2));
  process.stdout.write(
    `LOCK ${ARTIFACT}-slice.mp4 · ${durationSeconds.toFixed(1)}s · spend $${spend.toFixed(2)} · cumulative ~$${(PRIOR_CUMULATIVE + spend).toFixed(2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
