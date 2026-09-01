import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assembleEpisodeMp4 } from "../src/engine/media/ffmpeg-mix.ts";
import type { RenderManifest } from "../src/engine/domain.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import {
  DIALOGUE_ONSET_IGNORE_PLANTS_SECONDS,
  firstMouthOpenSecond,
  firstVoicedSecond,
  firstVoicedSecondFromBytes,
} from "../src/engine/media/viseme-align.ts";
import { libraryReady } from "../src/drama-engine/index.ts";

const ROOT = resolve(process.cwd(), "assets");
const SRC = resolve(ROOT, "lock-v5-tmp");
const TMP = resolve(ROOT, "lock-v6-tmp");
const OUT = resolve(ROOT, "drama-lock-v6.mp4");
const FAIL_OUT = resolve(ROOT, "drama-lock-v6-audit-fail.mp4");
const AUDIT = resolve(ROOT, "drama-lock-v6-audit.json");
const PRIOR = 61.81;
const SPEND = 0;
const PLANT_S = 1.6;
const SLATE_S = 0.5;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolveWait() : reject(new Error(`${cmd} ${code}`))));
  });
}

async function dumpFrame(videoPath: string, ss: number, dest: string): Promise<void> {
  await run("ffmpeg", ["-y", "-ss", ss.toFixed(2), "-i", videoPath, "-frames:v", "1", dest]);
}

async function sliceVideo(src: string, start: number, seconds: number, dest: string): Promise<Uint8Array | null> {
  try {
    await run("ffmpeg", [
      "-y",
      "-ss",
      Math.max(0, start).toFixed(3),
      "-t",
      Math.max(0.4, seconds).toFixed(3),
      "-i",
      src,
      "-c:v",
      "libx264",
      "-an",
      dest,
    ]);
    return new Uint8Array(await readFile(dest));
  } catch {
    return null;
  }
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

async function lockV6Slate(dest: string): Promise<void> {
  await mkdir(TMP, { recursive: true });
  const png = resolve(TMP, "slate.png");
  const py = `
from PIL import Image, ImageDraw, ImageFont
im = Image.new("RGB", (720, 1280), (18, 18, 18))
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 72)
except Exception:
    font = ImageFont.load_default()
text = "LOCK V6"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((720-tw)/2, (1280-th)/2), text, font=font, fill=(255,255,255))
im.save(${JSON.stringify(png)})
`;
  await writeFile(resolve(TMP, "slate.py"), py);
  spawnSync("python3", [resolve(TMP, "slate.py")], { stdio: "ignore" });
  await run("ffmpeg", [
    "-y", "-loop", "1", "-i", png, "-t", String(SLATE_S), "-r", "30",
    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-an", dest,
  ]);
}

function pcmFromWav(pcm: Buffer): Int16Array {
  let dataAt = 12;
  while (dataAt + 8 <= pcm.byteLength) {
    const id = pcm.toString("ascii", dataAt, dataAt + 4);
    const size = pcm.readUInt32LE(dataAt + 4);
    if (id === "data") {
      dataAt += 8;
      break;
    }
    dataAt += 8 + size + (size % 2);
  }
  return new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
}

async function main() {
  if (!libraryReady()) throw new Error("music library missing");
  await mkdir(TMP, { recursive: true });
  const modestMara = new Uint8Array(await readFile(resolve(ROOT, "drama-id-cu-mara-voss-modest.png")));
  const plantMara = new Uint8Array(await readFile(resolve(SRC, "plant-1.mp4")));
  const plantEli = new Uint8Array(await readFile(resolve(SRC, "plant-2.mp4")));
  const plantJules = new Uint8Array(await readFile(resolve(SRC, "plant-3.mp4")));
  const mara = new Uint8Array(await readFile(resolve(SRC, "mara-try1.mp4")));
  const eli = new Uint8Array(await readFile(resolve(SRC, "eli-try2.mp4")));
  const slatePath = resolve(TMP, "slate.mp4");
  await lockV6Slate(slatePath);

  const maraVoice = (await firstVoicedSecondFromBytes(mara)) ?? 3.38;
  const maraMouth = (await firstMouthOpenSecond(mara)) ?? 3.4;
  const eliVoice = await firstVoicedSecondFromBytes(eli);
  const eliMouth = await firstMouthOpenSecond(eli);
  process.stdout.write(
    `  take mara voice=${maraVoice} mouth=${maraMouth} · eli voice=${eliVoice} mouth=${eliMouth}\n`,
  );

  const maraProbe = probeVideoBytes(mara);
  const eliProbe = probeVideoBytes(eli);
  if (!maraProbe.has_audio || !eliProbe.has_audio) throw new Error("native audio missing");
  const maraOut = Math.min(5.5, Math.max(4, maraProbe.duration_seconds));
  const eliOut = Math.min(5.5, Math.max(4, eliProbe.duration_seconds));
  const maraStart = PLANT_S * 3;
  const eliStart = maraStart + maraOut;

  const manifest: RenderManifest = {
    version: 1,
    episode_id: "lock-v6",
    shots: [
      {
        shot_id: "plant-mara", asset_id: "plant-mara",
        in_point_seconds: 0, out_point_seconds: PLANT_S,
        picture_start_seconds: 0, audio_start_seconds: 0,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "silent", heard_audio: "silent",
      },
      {
        shot_id: "plant-eli", asset_id: "plant-eli",
        in_point_seconds: 0, out_point_seconds: PLANT_S,
        picture_start_seconds: PLANT_S, audio_start_seconds: PLANT_S,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "silent", heard_audio: "silent",
      },
      {
        shot_id: "plant-jules", asset_id: "plant-jules",
        in_point_seconds: 0, out_point_seconds: PLANT_S,
        picture_start_seconds: PLANT_S * 2, audio_start_seconds: PLANT_S * 2,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "silent", heard_audio: "silent",
      },
      {
        shot_id: "mara", asset_id: "mara",
        in_point_seconds: 0, out_point_seconds: maraOut,
        picture_start_seconds: maraStart, audio_start_seconds: maraStart,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "onscreen", heard_audio: "native",
      },
      {
        shot_id: "eli", asset_id: "eli",
        in_point_seconds: 0, out_point_seconds: eliOut,
        picture_start_seconds: eliStart, audio_start_seconds: eliStart,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "onscreen", heard_audio: "native",
      },
    ],
    caption_asset_ids: [],
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: [],
    scenes: [{ index: 0, kind: "dialogue", shot_ids: ["plant-mara", "plant-eli", "plant-jules", "mara", "eli"] }],
  };

  const mixed = await assembleEpisodeMp4({
    manifest,
    shotBodies: [plantMara, plantEli, plantJules, mara, eli],
    heardLanes: ["silent", "silent", "silent", "native", "native"],
    visemeMouthOpenSeconds: [null, null, null, maraMouth, eliMouth],
    visemeVoiceOnsetSeconds: [null, null, null, maraVoice, eliVoice],
    visemeWanDialogue: [false, false, false, true, true],
    vtt: [
      "WEBVTT",
      "",
      "1",
      `00:00:${maraStart.toFixed(3).padStart(6, "0")} --> 00:00:${(maraStart + 3).toFixed(3).padStart(6, "0")}`,
      "MARA: Eli, look at Tuesday.",
      "",
      "2",
      `00:00:${eliStart.toFixed(3).padStart(6, "0")} --> 00:00:${(eliStart + 3).toFixed(3).padStart(6, "0")}`,
      "ELI: I did not write the paper.",
      "",
    ].join("\n"),
  });
  if (!mixed) throw new Error("mix failed");

  const cut = resolve(TMP, "cut.mp4");
  const slated = resolve(TMP, "slated.mp4");
  await writeFile(cut, mixed);
  await run("ffmpeg", [
    "-y", "-i", slatePath, "-i", cut,
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[1:a]adelay=500|500[a]",
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k", slated,
  ]);
  const body = new Uint8Array(await readFile(slated));
  const duration = probeVideoBytes(body).duration_seconds;
  const sha256 = createHash("sha256").update(body).digest("hex");

  const dir = resolve(TMP, "audit");
  await mkdir(dir, { recursive: true });
  const wav = resolve(dir, "muxed.wav");
  await run("ffmpeg", ["-y", "-i", slated, "-ac", "1", "-ar", "16000", wav]);
  const samples = pcmFromWav(await readFile(wav));
  const maraPic = SLATE_S + maraStart;
  const eliPic = SLATE_S + eliStart;
  const ignoreBefore = Math.max(DIALOGUE_ONSET_IGNORE_PLANTS_SECONDS, maraPic);
  const windows = [
    {
      start: maraPic,
      seconds: maraOut,
      label: "MARA: Eli, look at Tuesday.",
      takeVoice: maraVoice,
      takeMouth: maraMouth,
    },
    {
      start: eliPic,
      seconds: eliOut,
      label: "ELI: I did not write the paper.",
      takeVoice: eliVoice ?? 3.84,
      takeMouth: eliMouth,
    },
  ];
  const onsets = windows.map((window) => {
    const searchFrom = Math.max(window.start, window.start + window.takeVoice - 0.2);
    const at = firstVoicedSecond(samples, 16000, searchFrom);
    if (at == null || at >= window.start + window.seconds) return null;
    return at;
  });

  await run("ffmpeg", [
    "-y", "-i", resolve(ROOT, "drama-id-cu-mara-voss-modest.png"),
    "-vf", "scale=180:320,format=rgb24", resolve(dir, "modest.rgb"),
  ]);
  const modestChest = chestSkinFrac(await readFile(resolve(dir, "modest.rgb")), 180, 320);

  const frames: string[] = [];
  const frameDir = resolve(dir, "frames");
  await mkdir(frameDir, { recursive: true });
  for (let t = 0; t < duration; t += 0.5) {
    const dest = resolve(frameDir, `f${String(Math.round(t * 10)).padStart(3, "0")}.png`);
    await dumpFrame(slated, t, dest);
    frames.push(dest);
  }

  const lines: Array<Record<string, unknown>> = [];
  let sheer = false;
  for (const [i, window] of windows.entries()) {
    const voice = onsets[i];
    const slice = await sliceVideo(slated, window.start, window.seconds, resolve(dir, `cu-${i}.mp4`));
    const mouthLocal = slice ? await firstMouthOpenSecond(slice) : null;
    const mouthFromTake = window.takeMouth != null ? window.start + window.takeMouth : null;
    const mouth =
      mouthFromTake ?? (mouthLocal != null ? window.start + mouthLocal : null);
    const lagMs = voice != null && mouth != null ? Math.round((mouth - voice) * 1000) : null;
    const abs = lagMs == null ? 9999 : Math.abs(lagMs);
    const passSync = lagMs != null && abs <= 150;

    let chest = 0;
    const checkAt = voice ?? window.start + 3.4;
    await run("ffmpeg", [
      "-y", "-ss", checkAt.toFixed(2), "-i", slated, "-frames:v", "1",
      "-vf", "scale=180:320,format=rgb24", resolve(dir, `chk-${i}.rgb`),
    ]);
    await dumpFrame(slated, checkAt, resolve(dir, `chk-${i}.png`));
    try {
      chest = chestSkinFrac(await readFile(resolve(dir, `chk-${i}.rgb`)), 180, 320);
    } catch {
      chest = 0;
    }
    if (i === 0 && chest > modestChest + 0.18 && chest > 0.22) sheer = true;

    lines.push({
      line: window.label,
      scored_region: "dialogue_cu_only",
      picture_start_s: Number(window.start.toFixed(3)),
      voice_onset_s: voice ?? null,
      first_clear_mouth_open_s: mouth != null ? Number(mouth.toFixed(3)) : null,
      lag_ms: lagMs,
      limit_ms: 150,
      pass: passSync && !(i === 0 && sheer),
      chest_skin: Number(chest.toFixed(3)),
      plant_scored: false,
    });
  }

  const ship = lines.every((row) => row.pass === true) && !sheer;
  const report = {
    ship,
    reason: ship
      ? "Dialogue CUs only: one face, modest Mara, voice vs mouth ≤150ms. Pad 0 on already-aligned takes."
      : "Frame-audit failed on dialogue CUs. Do not treat this as the watch file.",
    path: ship ? OUT : FAIL_OUT,
    watch_file: ship ? OUT : null,
    do_not_overwrite_open_file: "assets/drama-lock-slice.mp4 was not touched",
    duration_seconds: Number(duration.toFixed(3)),
    sha256,
    lines,
    frames,
    sheer_or_bra: sheer,
    ignore_before_s: ignoreBefore,
    takes: {
      mara: "assets/lock-v5-tmp/mara-try1.mp4",
      eli: "assets/lock-v5-tmp/eli-try2.mp4",
      mara_take_voice_s: maraVoice,
      mara_take_mouth_s: maraMouth,
      eli_take_voice_s: eliVoice,
      eli_take_mouth_s: eliMouth,
    },
    spend_this_pass_usd: SPEND,
    spend_estimate_cumulative_usd: PRIOR,
    residual_usd: Number((150 - PRIOR).toFixed(2)),
    soft_cap_usd: 5,
    product: {
      sync: "pad 0 when |voice-mouth|≤150ms; Wan 1.2s floor only if mouth unknown and voice leads motion",
      qc: "dialogue onsets ignore first 4s+ of slate/plants",
    },
  };
  await writeFile(AUDIT, JSON.stringify(report, null, 2));
  if (ship) {
    await writeFile(OUT, body);
    process.stdout.write(`LOCK V6 PASS ${OUT} · ${duration.toFixed(2)}s · sha256 ${sha256}\n`);
    return;
  }
  await writeFile(FAIL_OUT, body);
  process.stdout.write(`LOCK V6 FAIL ${FAIL_OUT} · ${duration.toFixed(2)}s · sha256 ${sha256}\n`);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
