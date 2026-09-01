import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assembleEpisodeMp4 } from "../src/engine/media/ffmpeg-mix.ts";
import type { RenderManifest } from "../src/engine/domain.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { firstVoicedSecond, firstVoicedSecondFromBytes } from "../src/engine/media/viseme-align.ts";
import { libraryReady } from "../src/drama-engine/index.ts";

const ROOT = resolve(process.cwd(), "assets");
const SRC = resolve(ROOT, "lock-v5-tmp");
const TMP = resolve(ROOT, "lock-v8-tmp");
const OUT = resolve(ROOT, "drama-lock-v8.mp4");
const FAIL_OUT = resolve(ROOT, "drama-lock-v8-audit-fail.mp4");
const AUDIT = resolve(ROOT, "drama-lock-v8-audit.json");
const PRIOR = 61.81;
const SPEND = 0;
const SLATE_S = 0.3;
/** Measured on mara-try1 / v7: identity still → sitting at the night window. */
const MARA_SETTLE_S = 1.8;
const ELI_HEAD_TRIM_S = 0.3;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolveWait() : reject(new Error(`${cmd} ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

async function dumpFrame(videoPath: string, ss: number, dest: string): Promise<void> {
  await run("ffmpeg", ["-y", "-ss", ss.toFixed(2), "-i", videoPath, "-frames:v", "1", dest]);
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

async function lockV8Slate(dest: string): Promise<void> {
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
text = "LOCK V8"
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

async function grayMeanAbs(aPath: string, bPath: string): Promise<number> {
  const raw = async (p: string) => {
    const dest = p.replace(/\.png$/, ".gray");
    await run("ffmpeg", ["-y", "-i", p, "-vf", "scale=90:160,format=gray", "-f", "rawvideo", dest]);
    return readFile(dest);
  };
  const a = await raw(aPath);
  const b = await raw(bPath);
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return n ? s / n : 0;
}

async function main() {
  if (!libraryReady()) throw new Error("music library missing");
  await mkdir(TMP, { recursive: true });
  const mara = new Uint8Array(await readFile(resolve(SRC, "mara-try1.mp4")));
  const eliSrc = resolve(SRC, "eli-try2.mp4");
  const eliTrimmed = resolve(TMP, "eli-from-motion.mp4");
  await run("ffmpeg", [
    "-y", "-ss", ELI_HEAD_TRIM_S.toFixed(3), "-i", eliSrc,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    eliTrimmed,
  ]);
  const eli = new Uint8Array(await readFile(eliTrimmed));
  const slatePath = resolve(TMP, "slate.mp4");
  await lockV8Slate(slatePath);

  const maraVoice = (await firstVoicedSecondFromBytes(mara)) ?? 3.38;
  const maraMouth = 3.4;
  const eliVoice = (await firstVoicedSecondFromBytes(eli)) ?? 3.54;
  const eliMouthOnTake = 3.5;
  process.stdout.write(
    `  take mara voice=${maraVoice} mouth=${maraMouth} settle=${MARA_SETTLE_S} · eli voice=${eliVoice} mouth=${eliMouthOnTake} pad=0\n`,
  );

  const maraProbe = probeVideoBytes(mara);
  const eliProbe = probeVideoBytes(eli);
  if (!maraProbe.has_audio || !eliProbe.has_audio) throw new Error("native audio missing");
  const maraOut = Math.min(5.5, Math.max(4, maraProbe.duration_seconds));
  const eliOut = Math.min(5.5, Math.max(4, eliProbe.duration_seconds));
  const maraPicture = maraOut - MARA_SETTLE_S;

  const manifest: RenderManifest = {
    version: 1,
    episode_id: "lock-v8",
    shots: [
      {
        shot_id: "mara", asset_id: "mara",
        in_point_seconds: MARA_SETTLE_S, out_point_seconds: maraOut,
        picture_start_seconds: 0, audio_start_seconds: 0,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "onscreen", heard_audio: "native",
      },
      {
        shot_id: "eli", asset_id: "eli",
        in_point_seconds: 0, out_point_seconds: eliOut,
        picture_start_seconds: maraPicture, audio_start_seconds: maraPicture,
        hold_tail_seconds: 0, scene_kind: "dialogue", transition_in: "cut",
        audio_role: "onscreen", heard_audio: "native",
      },
    ],
    caption_asset_ids: [],
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: [],
    scenes: [{ index: 0, kind: "dialogue", shot_ids: ["mara", "eli"] }],
  };

  const mixed = await assembleEpisodeMp4({
    manifest,
    shotBodies: [mara, eli],
    heardLanes: ["native", "native"],
    visemePadSeconds: [0, 0],
    visemeMouthOpenSeconds: [maraMouth, eliMouthOnTake],
    visemeVoiceOnsetSeconds: [maraVoice, eliVoice],
    visemeWanDialogue: [true, true],
    vtt: [
      "WEBVTT",
      "",
      "1",
      `00:00:00.000 --> 00:00:03.000`,
      "MARA: Eli, look at Tuesday.",
      "",
      "2",
      `00:00:${maraPicture.toFixed(3).padStart(6, "0")} --> 00:00:${(maraPicture + 3).toFixed(3).padStart(6, "0")}`,
      "ELI: I did not write the paper.",
      "",
    ].join("\n"),
  });
  if (!mixed) throw new Error("mix failed");

  const cut = resolve(TMP, "cut.mp4");
  const slated = resolve(TMP, "slated.mp4");
  await writeFile(cut, mixed);
  const slateMs = Math.round(SLATE_S * 1000);
  await run("ffmpeg", [
    "-y", "-i", slatePath, "-i", cut,
    "-filter_complex", `[0:v][1:v]concat=n=2:v=1:a=0[v];[1:a]adelay=${slateMs}|${slateMs}[a]`,
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
  const maraPic = SLATE_S;
  const eliPic = SLATE_S + maraPicture;
  const windows = [
    {
      start: maraPic,
      seconds: maraPicture,
      label: "MARA: Eli, look at Tuesday.",
      takeVoice: maraVoice,
      takeMouth: maraMouth,
      pad: 0,
      inPoint: MARA_SETTLE_S,
      limitMs: 80,
    },
    {
      start: eliPic,
      seconds: eliOut,
      label: "ELI: I did not write the paper.",
      takeVoice: eliVoice,
      takeMouth: eliMouthOnTake,
      pad: 0,
      inPoint: 0,
      limitMs: 200,
    },
  ];
  const onsets = windows.map((window) => {
    const searchFrom = Math.max(window.start, window.start + window.takeVoice + window.pad - window.inPoint - 0.25);
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
  for (let t = 0; t < duration; t += 0.25) {
    const dest = resolve(frameDir, `f${String(Math.round(t * 100)).padStart(4, "0")}.png`);
    await dumpFrame(slated, t, dest);
    frames.push(dest);
  }

  const afterSlate = resolve(dir, "open-after-slate.png");
  const identity = resolve(dir, "identity.png");
  const settled = resolve(dir, "settled-ref.png");
  await dumpFrame(slated, 0.05, resolve(dir, "open-0.00.png"));
  await dumpFrame(slated, SLATE_S + 0.05, afterSlate);
  await run("ffmpeg", [
    "-y", "-i", resolve(ROOT, "drama-id-cu-mara-voss-modest.png"),
    "-frames:v", "1", identity,
  ]);
  await dumpFrame(resolve(SRC, "mara-try1.mp4"), 2.0, settled);
  const vsIdentity = await grayMeanAbs(afterSlate, identity);
  const vsSettled = await grayMeanAbs(afterSlate, settled);
  const maraSettledOpen = vsIdentity > 16 && vsSettled < 20;

  const lines: Array<Record<string, unknown>> = [];
  let sheer = false;
  for (const [i, window] of windows.entries()) {
    const voice = onsets[i];
    const mouthOnMux = window.start + window.takeMouth - window.inPoint;
    const expectedVoice = window.start + window.takeVoice + window.pad - window.inPoint;
    const lagMs = voice != null ? Math.round((mouthOnMux - voice) * 1000) : null;
    const abs = lagMs == null ? 9999 : Math.abs(lagMs);
    const passSync = lagMs != null && abs <= window.limitMs;

    let chest = 0;
    const checkAt = voice ?? expectedVoice;
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
      expected_voice_s: Number(expectedVoice.toFixed(3)),
      first_clear_mouth_open_s: Number(mouthOnMux.toFixed(3)),
      lag_ms: lagMs,
      limit_ms: window.limitMs,
      pad_s: window.pad,
      in_point_s: window.inPoint,
      pass: passSync && !(i === 0 && sheer),
      chest_skin: Number(chest.toFixed(3)),
      plant_scored: false,
    });
  }

  const noNamePlants = duration < 14;
  const ship =
    lines.every((row) => row.pass === true) &&
    !sheer &&
    maraSettledOpen &&
    noNamePlants;

  const report = {
    ship,
    reason: ship
      ? "Mara CU starts after the I2V room morph. Picture and native audio trimmed by the same 1.8s. Eli unchanged from v7. Sync kept. No name-plants."
      : "Frame-audit failed. Do not treat this as the watch file.",
    path: ship ? OUT : FAIL_OUT,
    watch_file: ship ? OUT : null,
    do_not_overwrite: ["assets/drama-lock-v7.mp4", "assets/drama-lock-v6.mp4", "assets/drama-lock-slice.mp4"],
    duration_seconds: Number(duration.toFixed(3)),
    sha256,
    lines,
    frames,
    sheer_or_bra: sheer,
    mara_vs_identity: Number(vsIdentity.toFixed(3)),
    mara_vs_settled: Number(vsSettled.toFixed(3)),
    mara_room_morph: !maraSettledOpen,
    name_plants: false,
    takes: {
      mara: "assets/lock-v5-tmp/mara-try1.mp4",
      eli: "assets/lock-v5-tmp/eli-try2.mp4",
      mara_take_voice_s: maraVoice,
      mara_take_mouth_s: maraMouth,
      mara_settle_in_s: MARA_SETTLE_S,
      mara_audio_skip_s: MARA_SETTLE_S,
      eli_take_voice_s: eliVoice,
      eli_take_mouth_s: eliMouthOnTake,
      eli_audio_pad_s: 0,
    },
    spend_this_pass_usd: SPEND,
    spend_estimate_cumulative_usd: PRIOR,
    residual_usd: Number((150 - PRIOR).toFixed(2)),
    soft_cap_usd: 5,
    product: {
      sync: "I2V settle in-point trims picture and native audio by the same seconds; viseme pad still does not skip audio",
      cut: "name-plant stills removed; Mara morph skipped; speakers identified by NAME: line captions",
    },
  };
  await writeFile(AUDIT, JSON.stringify(report, null, 2));
  if (ship) {
    await writeFile(OUT, body);
    process.stdout.write(`LOCK V8 PASS ${OUT} · ${duration.toFixed(2)}s · sha256 ${sha256}\n`);
    return;
  }
  await writeFile(FAIL_OUT, body);
  process.stdout.write(`LOCK V8 FAIL ${FAIL_OUT} · ${duration.toFixed(2)}s · sha256 ${sha256}\n`);
  process.stdout.write(`${JSON.stringify({ lines, vsIdentity, vsSettled, sheer, noNamePlants }, null, 2)}\n`);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
