import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { kitchenLockPlan, libraryReady } from "../src/drama-engine/index.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { extractAudioMp3 } from "../src/engine/media/extract-audio.ts";
import { inventedSecondBody } from "../src/engine/media/second-body.ts";
import {
  firstMouthOpenSecond,
  firstVoicedSecond,
  firstVoicedSecondFromBytes,
} from "../src/engine/media/viseme-align.ts";
import { loadLocalEnv } from "./load-env.ts";

const ROOT = resolve(process.cwd(), "assets");
const TMP = resolve(ROOT, "lock-v5-tmp");
const OWNER = "live-lock-v5";
const SPEND_CAP = 150;
const SLICE_SOFT = 20;
const PRIOR_CUMULATIVE = 59.22;
const CU_MODEL = process.env.DRAMA_CU_MODEL?.trim() || "alibaba/wan-3.0";
const OUT = resolve(ROOT, "drama-lock-v5.mp4");
const FAIL_OUT = resolve(ROOT, "drama-lock-v5-audit-fail.mp4");
const AUDIT = resolve(ROOT, "drama-lock-v5-audit.json");
const MODEST_MARA = resolve(ROOT, "drama-id-cu-mara-voss-modest.png");
const ELI_STILL = resolve(ROOT, "drama-id-cu-eli-hart.png");
const JULES_STILL = resolve(ROOT, "drama-still-jules-renner.png");

type Engine = ReturnType<typeof createEngine>;

async function poll(app: Engine, jobId: string) {
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
    await new Promise((r) => setTimeout(r, 12_000));
  }
  throw new Error("Video poll timed out");
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolveWait() : reject(new Error(`${cmd} ${code}`))));
  });
}

async function stillHold(png: Uint8Array, name: string, dest: string, seconds = 1.6): Promise<Uint8Array> {
  await mkdir(TMP, { recursive: true });
  const still = resolve(TMP, `${name.replace(/\s+/g, "-").toLowerCase()}.png`);
  const labeled = resolve(TMP, `${name.replace(/\s+/g, "-").toLowerCase()}-card.png`);
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
  await writeFile(resolve(TMP, "label.py"), py);
  spawnSync("python3", [resolve(TMP, "label.py")], { stdio: "ignore" });
  await run("ffmpeg", [
    "-y", "-loop", "1", "-i", labeled, "-t", String(seconds), "-r", "30",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-an", dest,
  ]);
  return new Uint8Array(await readFile(dest));
}

async function lockV5Slate(dest: string): Promise<Uint8Array> {
  const png = resolve(TMP, "slate.png");
  const py = `
from PIL import Image, ImageDraw, ImageFont
im = Image.new("RGB", (720, 1280), (18, 18, 18))
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 72)
except Exception:
    font = ImageFont.load_default()
text = "LOCK V5"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((720-tw)/2, (1280-th)/2), text, font=font, fill=(255,255,255))
im.save(${JSON.stringify(png)})
`;
  await writeFile(resolve(TMP, "slate.py"), py);
  spawnSync("python3", [resolve(TMP, "slate.py")], { stdio: "ignore" });
  await run("ffmpeg", [
    "-y", "-loop", "1", "-i", png, "-t", "0.5", "-r", "30",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-an", dest,
  ]);
  return new Uint8Array(await readFile(dest));
}

function keepShot(shot: Shot): boolean {
  const fn = shot.shot_data.function;
  const dialogue = shot.shot_data.dialogue ?? "";
  if (fn === "name_plant") return true;
  if (fn === "establishing" || fn === "stacked_two") return false;
  if (fn === "reaction" || fn === "hook_cu" || fn === "insert_evidence" || fn === "button_cu") return false;
  if (/Then say who signed/i.test(dialogue)) return false;
  return fn === "accusation_cu";
}

function ecuCamera(name: string): string {
  return `extreme close-up, only ${name}'s face, no other person, no shoulder of anyone else, locked off`;
}

function voicedOnsets(samples: ArrayLike<number>, rate: number): number[] {
  const first = firstVoicedSecond(samples, rate);
  if (first == null) return [];
  const found = [first];
  const hop = Math.max(1, Math.round(rate * 0.01));
  const start = Math.round((first + 0.55) * rate);
  let quiet = 0;
  let armed = false;
  for (let i = start; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j += 1) sum += (samples[i + j] ?? 0) ** 2;
    const rms = Math.sqrt(sum / hop);
    if (rms < 400) {
      quiet += 1;
      if (quiet >= 25) armed = true;
    } else if (armed && rms >= 700) {
      found.push(Number((i / rate).toFixed(3)));
      armed = false;
      quiet = 0;
    } else {
      quiet = 0;
    }
  }
  return found;
}

function chestSkinFrac(pixels: Buffer, width: number, height: number): number {
  const x0 = Math.round(width * 0.28);
  const x1 = Math.round(width * 0.72);
  const y0 = Math.round(height * 0.42);
  const y1 = Math.round(height * 0.64);
  let skin = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * width + x) * 3;
      const r = pixels[o] ?? 0;
      const g = pixels[o + 1] ?? 0;
      const b = pixels[o + 2] ?? 0;
      n += 1;
      if (r > 90 && r > g + 8 && r > b + 6 && g > 45 && b > 35 && r < 240) skin += 1;
    }
  }
  return n ? skin / n : 0;
}

async function dumpFrame(videoPath: string, ss: number, dest: string): Promise<void> {
  await run("ffmpeg", ["-y", "-ss", ss.toFixed(2), "-i", videoPath, "-frames:v", "1", dest]);
}

async function frameRgbAt(videoPath: string, ss: number, dest: string): Promise<Buffer | null> {
  try {
    await run("ffmpeg", [
      "-y", "-ss", ss.toFixed(2), "-i", videoPath,
      "-frames:v", "1", "-vf", "scale=180:320,format=rgb24", dest.replace(/\.png$/, ".rgb"),
    ]);
    await dumpFrame(videoPath, ss, dest);
    return await readFile(dest.replace(/\.png$/, ".rgb"));
  } catch {
    return null;
  }
}

async function sliceVideo(src: string, start: number, seconds: number, dest: string): Promise<Uint8Array | null> {
  try {
    await run("ffmpeg", [
      "-y", "-ss", Math.max(0, start).toFixed(3), "-t", Math.max(0.4, seconds).toFixed(3),
      "-i", src, "-c:v", "libx264", "-an", dest,
    ]);
    return new Uint8Array(await readFile(dest));
  } catch {
    return null;
  }
}

function shipSync(lagMs: number | null): { pass: boolean; band: "80ms" | "150ms" | "fail" } {
  if (lagMs == null) return { pass: false, band: "fail" };
  const abs = Math.abs(lagMs);
  if (abs <= 80) return { pass: true, band: "80ms" };
  if (abs <= 150) return { pass: true, band: "150ms" };
  return { pass: false, band: "fail" };
}

async function auditMuxed(input: {
  body: Uint8Array;
  modestMara: Uint8Array;
}): Promise<{
  ship: boolean;
  reason: string;
  duration_seconds: number;
  sha256: string;
  lines: Array<Record<string, unknown>>;
  frames: string[];
  second_person: boolean;
  sheer_or_bra: boolean;
}> {
  const dir = resolve(TMP, "audit");
  await mkdir(dir, { recursive: true });
  const cut = resolve(dir, "muxed.mp4");
  await writeFile(cut, input.body);
  const duration = probeVideoBytes(input.body).duration_seconds;
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const wav = resolve(dir, "muxed.wav");
  await run("ffmpeg", ["-y", "-i", cut, "-ac", "1", "-ar", "16000", wav]);
  const pcm = await readFile(wav);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset + 44, Math.floor((pcm.byteLength - 44) / 2));
  const onsets = voicedOnsets(samples, 16000);

  const frameDir = resolve(dir, "frames");
  await mkdir(frameDir, { recursive: true });
  const frames: string[] = [];
  for (let t = 0; t < duration; t += 0.5) {
    const dest = resolve(frameDir, `f${String(Math.round(t * 10)).padStart(3, "0")}.png`);
    await dumpFrame(cut, t, dest);
    frames.push(dest);
  }

  await writeFile(resolve(dir, "modest-mara.png"), input.modestMara);
  await run("ffmpeg", ["-y", "-i", resolve(dir, "modest-mara.png"), "-vf", "scale=180:320,format=rgb24", resolve(dir, "modest.rgb")]);
  const modestRgb = await readFile(resolve(dir, "modest.rgb"));
  const modestChest = chestSkinFrac(modestRgb, 180, 320);

  let secondPerson = false;
  let sheer = false;
  const lineLabels = ["MARA: Eli, look at Tuesday.", "ELI: I did not write the paper."];
  const lines: Array<Record<string, unknown>> = [];

  for (let i = 0; i < 2; i += 1) {
    const voice = onsets[i];
    const windowStart = voice != null ? Math.max(0, voice - 0.2) : 4 + i * 5;
    const slice = await sliceVideo(cut, windowStart, 3.2, resolve(dir, `line-${i}.mp4`));
    const mouthLocal = slice ? await firstMouthOpenSecond(slice) : null;
    const mouth = mouthLocal != null ? windowStart + mouthLocal : null;
    const lagMs =
      voice != null && mouth != null ? Math.round((mouth - voice) * 1000) : voice != null && mouth == null ? 9999 : null;
    const sync = shipSync(lagMs === 9999 ? null : lagMs);

    const inspectAt = [voice ?? windowStart + 0.4, (voice ?? windowStart) + 0.6, (voice ?? windowStart) + 1.1];
    let extra = false;
    let chest = 0;
    for (const ss of inspectAt) {
      const dest = resolve(dir, `chk-${i}-${ss.toFixed(1)}.png`);
      const rgb = await frameRgbAt(cut, ss, dest);
      if (!rgb) continue;
      chest = Math.max(chest, chestSkinFrac(rgb, 180, 320));
      const ghostSlice = await sliceVideo(cut, Math.max(0, ss - 0.05), 0.4, resolve(dir, `ghost-${i}-${ss.toFixed(1)}.mp4`));
      const ghost = ghostSlice ? await inventedSecondBody(ghostSlice, i === 0 ? input.modestMara : null) : false;
      if (ghost) extra = true;
    }
    if (i === 0 && chest > modestChest + 0.18 && chest > 0.22) sheer = true;
    if (extra) secondPerson = true;
    const idleSecond = voice != null && mouth != null && mouth - voice >= 1;
    lines.push({
      line: lineLabels[i],
      voice_onset_s: voice ?? null,
      first_clear_mouth_open_s: mouth != null ? Number(mouth.toFixed(3)) : null,
      lag_ms: lagMs,
      limit_ms: sync.band === "150ms" ? 150 : 80,
      sync_band: sync.band,
      pass: sync.pass && !extra && !(i === 0 && sheer) && !idleSecond,
      extra_person: extra,
      chest_skin: Number(chest.toFixed(3)),
    });
  }

  const syncOk = lines.every((row) => row.pass === true);
  const ship = syncOk && !secondPerson && !sheer;
  return {
    ship,
    reason: ship
      ? "Frame-audit passed: one face, modest Mara, voice vs mouth within ship limit on the muxed file."
      : "Frame-audit failed. Do not treat this as the watch file.",
    duration_seconds: Number(duration.toFixed(3)),
    sha256,
    lines,
    frames,
    second_person: secondPerson,
    sheer_or_bra: sheer,
  };
}

async function generateCu(input: {
  app: Engine;
  shot: Shot;
  still: Uint8Array;
  seriesId: string;
  spend: number;
  maxTries: number;
  slug: string;
}): Promise<{ spend: number; accepted: boolean; log: Record<string, unknown> }> {
  const { app, still, seriesId, slug } = input;
  let spend = input.spend;
  const live0 = app.store.shots.get(input.shot.id)!;
  const who = live0.shot_data.speaker ?? live0.shot_data.speaker_on_camera ?? slug;
  app.store.shots.set(live0.id, {
    ...live0,
    shot_data: {
      ...live0.shot_data,
      comic_sting: false,
      sfx: null,
      camera: ecuCamera(who),
      camera_move: "locked-off",
    },
  });
  const seconds = Math.min(6, Math.max(4, live0.shot_data.duration_hint_seconds));
  const nextCost = pricing.estimateVideo(CU_MODEL, seconds) + 0.02;
  if (!app.store.shots.get(live0.id)!.shot_data.dialogue_audio_asset_id) {
    if (spend + 0.02 > SLICE_SOFT) {
      return { spend, accepted: false, log: { speaker: who, omitted: "soft_cap_tts" } };
    }
    await app.generateDialogue({ owner_id: OWNER, shot_id: live0.id });
    spend += 0.02;
  }

  for (let attempt = 1; attempt <= input.maxTries; attempt += 1) {
    if (spend + nextCost > SLICE_SOFT) {
      return { spend, accepted: false, log: { speaker: who, omitted: "soft_cap", try: attempt } };
    }
    const prior = app.store.shots.get(live0.id)!;
    app.store.shots.set(prior.id, {
      ...prior,
      selected_generation_id: null,
      shot_data: {
        ...prior.shot_data,
        identity_reject: false,
        comic_sting: false,
        sfx: null,
        camera: ecuCamera(who),
        camera_move: "locked-off",
      },
    });
    const row = app.store.shots.get(live0.id)!;
    const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: row.id, forceModel: CU_MODEL });
    process.stdout.write(
      `  gen ${slug} try=${attempt}/${input.maxTries} extra=${job.request_metadata.extra_ref_count ?? 0}\n`,
    );
    const finished = await poll(app, job.id);
    spend += finished.actual_cost ?? nextCost;
    process.stdout.write(`  qc ${JSON.stringify(finished.result_metadata ?? {})}\n`);
    const after = app.store.shots.get(row.id)!;
    const metaAsset = finished.result_metadata?.asset_id;
    const takeId = after.selected_generation_id ?? (typeof metaAsset === "string" ? metaAsset : null);
    if (!takeId) {
      process.stdout.write(`  ${slug} try=${attempt} no_take\n`);
      continue;
    }
    const take = await app.assets.get(takeId);
    if (!take) continue;
    const dest = resolve(TMP, `${slug}-try${attempt}.mp4`);
    await writeFile(dest, take.body);
    await dumpFrame(dest, 0.4, resolve(TMP, `${slug}-try${attempt}-f04.png`));
    await dumpFrame(dest, 1.2, resolve(TMP, `${slug}-try${attempt}-f12.png`));
    const probe = probeVideoBytes(take.body);
    const ghost = await inventedSecondBody(take.body, still);
    if (!probe.has_audio || ghost) {
      app.store.shots.set(row.id, {
        ...after,
        selected_generation_id: null,
        shot_data: { ...after.shot_data, identity_reject: true, heard_audio: "silent" },
      });
      process.stdout.write(`  ${slug} try=${attempt} reject ${ghost ? "second_person" : "no_native_audio"}\n`);
      continue;
    }
    try {
      await extractAudioMp3(take.body);
    } catch {
      app.store.shots.set(row.id, {
        ...after,
        selected_generation_id: null,
        shot_data: { ...after.shot_data, identity_reject: true },
      });
      process.stdout.write(`  ${slug} try=${attempt} native_extract_failed\n`);
      continue;
    }
    const voiceOnset = await firstVoicedSecondFromBytes(take.body);
    const mouthOpen = await firstMouthOpenSecond(take.body);
    app.store.shots.set(row.id, {
      ...after,
      selected_generation_id: takeId,
      status: "complete",
      shot_data: { ...after.shot_data, heard_audio: "native", identity_reject: false, comic_sting: false, sfx: null },
    });
    process.stdout.write(`  ${slug} accepted try=${attempt} voice=${voiceOnset} mouth=${mouthOpen}\n`);
    return {
      spend,
      accepted: true,
      log: {
        speaker: who,
        heard_audio: "native",
        try: attempt,
        extra_ref_count: job.request_metadata.extra_ref_count ?? 0,
        first_frame: job.request_metadata.first_frame_asset_id,
        cost: finished.actual_cost,
        take_voice_onset_s: voiceOnset,
        take_mouth_open_s: mouthOpen,
        path: dest,
        series_id: seriesId,
      },
    };
  }
  return { spend, accepted: false, log: { speaker: who, omitted: "identity_reject_or_no_take", tries: input.maxTries } };
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
  process.env.DRAMA_IDENTITY_REF_POLICY = "face_only";
  process.env.DRAMA_CU_MODEL = CU_MODEL;
  await mkdir(ROOT, { recursive: true });
  await mkdir(TMP, { recursive: true });
  if (!libraryReady()) {
    const generated = spawnSync("npx", ["tsx", "scripts/generate-music-library.ts"], { stdio: "inherit" });
    if (generated.status !== 0) throw new Error("Music library generation failed");
  }

  const modestMara = new Uint8Array(await readFile(MODEST_MARA));
  const eliStill = new Uint8Array(await readFile(ELI_STILL));
  const julesStill = new Uint8Array(await readFile(JULES_STILL));
  const haveModest = await access(MODEST_MARA).then(() => true).catch(() => false);
  if (!haveModest) throw new Error("modest Mara still missing");
  process.stdout.write("  reuse modest Mara still (v4 take bytes were not persisted)\n");

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
    title: `${bible.title} V5`,
    description: bible.logline,
  });
  await app.handleStripeWebhook({
    event_id: `evt_drama_lock_v5_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 25,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  app.store.series.set(series.id, { ...app.store.series.get(series.id)!, story_bible: bible });
  const stillBytes = new Map<string, Uint8Array>();
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const body = /mara/i.test(character.name) ? modestMara : /eli/i.test(character.name) ? eliStill : julesStill;
    stillBytes.set(character.name, body);
    const asset = await app.assets.put({
      id: `drama-lock-v5-cu-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-lock-v5-cu-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-lock-v5-cu-${slug}`,
      metadata: { kind: "cu", name: character.name, crop_version: "cu-28", locked: true, modest: /mara/i.test(character.name) },
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

  const episode = await app.createEpisode({
    owner_id: OWNER,
    series_id: series.id,
    episode_number: 1,
    title: "LOCK V5",
  });
  const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "60_90" });
  const slatePath = resolve(TMP, "slate.mp4");
  const slate = await lockV5Slate(slatePath);
  await app.assets.put({
    id: "lock-v5-slate",
    owner_id: OWNER,
    series_id: series.id,
    kind: "shot_video",
    bucket: "private-generation",
    storage_path: `private-generation/${series.id}/lock-v5-slate.mp4`,
    mime_type: "video/mp4",
    body: slate,
    checksum: "lock-v5-slate",
    metadata: { slate: "LOCK V5" },
    created_at: new Date().toISOString(),
  });

  const takes: Array<Record<string, unknown>> = [];
  const playableIds: string[] = [];
  let maraShot: Shot | null = null;
  let eliShot: Shot | null = null;

  for (const [index, shot] of planned.shots.entries()) {
    const live = app.store.shots.get(shot.id)!;
    if (!keepShot(live)) {
      app.store.shots.set(live.id, { ...live, shot_data: { ...live.shot_data, identity_reject: true } });
      takes.push({ function: live.shot_data.function, skipped: "v5_omit" });
      continue;
    }
    if (live.shot_data.function === "name_plant") {
      const who = live.shot_data.speaker_on_camera ?? live.shot_data.speaker ?? "CAST";
      const png = stillBytes.get(who) ?? [...stillBytes.values()][0]!;
      const dest = resolve(TMP, `plant-${index}.mp4`);
      const body = await stillHold(png, who, dest);
      const asset = await app.assets.put({
        id: `lock-v5-plant-${index}`,
        owner_id: OWNER,
        series_id: series.id,
        kind: "shot_video",
        bucket: "private-generation",
        storage_path: `private-generation/${series.id}/lock-v5-plant-${index}.mp4`,
        mime_type: "video/mp4",
        body,
        checksum: `lock-v5-plant-${index}`,
        metadata: { shot_id: live.id, name_plant: who },
        created_at: new Date().toISOString(),
      });
      app.store.shots.set(live.id, {
        ...live,
        status: "complete",
        selected_generation_id: asset.id,
        shot_data: { ...live.shot_data, heard_audio: "silent" },
      });
      playableIds.push(live.id);
      process.stdout.write(`  plant ${who}\n`);
      takes.push({ function: "name_plant", speaker: who });
      continue;
    }
    if (/mara/i.test(live.shot_data.speaker ?? "")) maraShot = live;
    if (/eli/i.test(live.shot_data.speaker ?? "")) eliShot = live;
  }

  if (!maraShot || !eliShot) throw new Error("Plan is missing Mara or Eli accusation CU");

  let spend = 0;
  let loops = 0;
  // Assigned inside `muxIfReady`; the cast stops TS narrowing these to `never` after the loop.
  let lastAudit = null as Awaited<ReturnType<typeof auditMuxed>> | null;
  let lastMux = null as Uint8Array | null;
  let lastVtt = undefined as string | undefined;
  let maraOk = false;
  let eliOk = false;

  const muxIfReady = async () => {
    const dialogueIds = playableIds.filter((id) => app.store.shots.get(id)?.shot_data.dialogue);
    if (dialogueIds.length < 2) return null;
    const rendered = await app.renderEpisode({
      owner_id: OWNER,
      episode_id: episode.id,
      shot_ids: playableIds,
    });
    const body = (await app.assets.get(rendered.asset.id))!.body;
    const cut = resolve(TMP, "cut.mp4");
    const slated = resolve(TMP, "slated.mp4");
    await writeFile(cut, body);
    await run("ffmpeg", [
      "-y", "-i", slatePath, "-i", cut,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[1:a]adelay=500|500[a]",
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k", slated,
    ]);
    lastMux = new Uint8Array(await readFile(slated));
    lastVtt = rendered.vtt;
    lastAudit = await auditMuxed({ body: lastMux, modestMara });
    return lastAudit;
  };

  for (let loop = 1; loop <= 2; loop += 1) {
    loops = loop;
    process.stdout.write(`\n== LOCK V5 loop ${loop} ==\n`);
    if (!maraOk) {
      const mara = await generateCu({
        app,
        shot: maraShot,
        still: modestMara,
        seriesId: series.id,
        spend,
        maxTries: 1,
        slug: "mara",
      });
      spend = mara.spend;
      takes.push({ function: "accusation_cu", loop, ...mara.log });
      if (mara.accepted) {
        maraOk = true;
        playableIds.push(maraShot.id);
      }
    }
    if (!eliOk) {
      const eliTries = loop === 1 ? 3 : 1;
      const eli = await generateCu({
        app,
        shot: eliShot,
        still: eliStill,
        seriesId: series.id,
        spend,
        maxTries: eliTries,
        slug: "eli",
      });
      spend = eli.spend;
      takes.push({ function: "accusation_cu", loop, ...eli.log });
      if (eli.accepted) {
        eliOk = true;
        playableIds.push(eliShot.id);
      }
    }

    if (!maraOk || !eliOk) {
      process.stdout.write(`  loop ${loop} missing CU mara=${maraOk} eli=${eliOk}\n`);
      if (loop === 1) {
        maraOk = maraOk;
        eliOk = eliOk;
        continue;
      }
      break;
    }

    const audit = await muxIfReady();
    if (audit?.ship) break;
    process.stdout.write(`  loop ${loop} audit fail\n`);
    if (loop === 1 && lastAudit) {
      const maraLine = lastAudit.lines[0];
      const eliLine = lastAudit.lines[1];
      if (maraLine && maraLine.pass !== true) {
        maraOk = false;
        const idx = playableIds.indexOf(maraShot.id);
        if (idx >= 0) playableIds.splice(idx, 1);
        app.store.shots.set(maraShot.id, {
          ...app.store.shots.get(maraShot.id)!,
          selected_generation_id: null,
          shot_data: { ...app.store.shots.get(maraShot.id)!.shot_data, identity_reject: true },
        });
      }
      if (eliLine && eliLine.pass !== true) {
        eliOk = false;
        const idx = playableIds.indexOf(eliShot.id);
        if (idx >= 0) playableIds.splice(idx, 1);
        app.store.shots.set(eliShot.id, {
          ...app.store.shots.get(eliShot.id)!,
          selected_generation_id: null,
          shot_data: { ...app.store.shots.get(eliShot.id)!.shot_data, identity_reject: true },
        });
      }
    }
  }

  const ship = Boolean(lastAudit?.ship);
  const report = {
    ship,
    reason: lastAudit?.reason
      ?? (maraOk && eliOk ? "Muxed but audit missing" : "Missing single-face native CU. Stop."),
    path: ship ? OUT : lastMux ? FAIL_OUT : null,
    watch_file: ship ? OUT : null,
    do_not_overwrite_open_file: "assets/drama-lock-slice.mp4 was not touched",
    duration_seconds: lastAudit?.duration_seconds ?? null,
    sha256: lastAudit?.sha256 ?? null,
    loops,
    lines: lastAudit?.lines ?? [],
    second_person: lastAudit?.second_person ?? !eliOk,
    sheer_or_bra: lastAudit?.sheer_or_bra ?? false,
    modest_mara_still: { path: "assets/drama-id-cu-mara-voss-modest.png", used_as_first_frame: true },
    takes,
    vtt: lastVtt,
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    residual_usd: Number((SPEND_CAP - PRIOR_CUMULATIVE - spend).toFixed(4)),
    soft_cap_usd: SLICE_SOFT,
    product: {
      sync: "1.2s Wan pad / viseme align in mixer; ship ≤80ms or ≤150ms if not voice-then-idle",
      coverage: "extreme close-up, one face, locked off, no OTS",
      note: "v4 Mara take was in-memory only and could not be reused",
    },
  };
  await writeFile(AUDIT, JSON.stringify(report, null, 2));
  if (lastVtt) await writeFile(resolve(ROOT, "drama-lock-v5-captions.vtt"), lastVtt);
  if (ship && lastMux) {
    await writeFile(OUT, lastMux);
    process.stdout.write(
      `LOCK V5 PASS ${OUT} · ${lastAudit!.duration_seconds}s · sha256 ${lastAudit!.sha256} · spend $${spend.toFixed(2)}\n`,
    );
    return;
  }
  if (lastMux) await writeFile(FAIL_OUT, lastMux);
  process.stdout.write(
    `LOCK V5 FAIL · spend $${spend.toFixed(2)} · mara=${maraOk} eli=${eliOk} · ${lastAudit?.reason ?? "no mux"}\n`,
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
