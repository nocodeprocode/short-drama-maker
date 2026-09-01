import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderManifest } from "../domain.ts";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { libraryReady, loadMusicBytes, pickMusic } from "../../drama-engine/craft/music/library.ts";
import { CAPTION_STYLE, LOUDNESS, speakerCaptionColor, type HeardLane } from "../../drama-engine/types/audio.ts";
import { cuesFromVtt, wrapCaptionLines } from "../pipeline/captions.ts";
import { heardDelaySeconds, heardFileSkipSeconds } from "../pipeline/heard-audio.ts";
import { visemeAlignForTake } from "./viseme-align.ts";

export type MixInput = {
  manifest: RenderManifest;
  shotBodies: Uint8Array[];
  ttsBodies?: Array<Uint8Array | null>;
  nativeAudio?: Array<Uint8Array | null>;
  heardLanes?: Array<HeardLane | null>;
  vtt?: string;
  /** Test hook: first mouth-open on that take, seconds from take start. */
  visemeMouthOpenSeconds?: Array<number | null | undefined>;
  /** Test hook: first voiced sample on that take, seconds from take start. */
  visemeVoiceOnsetSeconds?: Array<number | null | undefined>;
  /** Test hook: treat the take as Wan audio-conditioned dialogue (1.2s default pad). */
  visemeWanDialogue?: Array<boolean | null | undefined>;
  /** Per-take heard delay. When set, skip probe/align for that shot (keep picture in-point). */
  visemePadSeconds?: Array<number | null | undefined>;
};

/** Audio-conditioned takes keep the file Wan returned. Never strip and replace with TTS. */
export function shouldKeepTakeAudio(lane?: HeardLane | null): boolean {
  return lane === "native";
}

export function heardBodyForShot(
  lane: HeardLane,
  native: Uint8Array | null | undefined,
  tts: Uint8Array | null | undefined,
): Uint8Array | null {
  if (lane === "silent") return null;
  if (lane === "native") return native ?? null;
  return tts ?? null;
}

async function trimHeardBytes(dir: string, index: number, body: Uint8Array, skipSeconds: number): Promise<Uint8Array> {
  const raw = join(dir, `heard-raw-${index}.bin`);
  const out = join(dir, `heard-trim-${index}.wav`);
  await writeFile(raw, body);
  try {
    await run("ffmpeg", ["-y", "-ss", skipSeconds.toFixed(3), "-i", raw, "-vn", "-ac", "1", "-ar", "44100", out]);
    return new Uint8Array(await readFile(out));
  } catch {
    return body;
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

/** Silence only. A sine/ping bed is banned — never regenerate one here. */
export function silentWav(seconds: number): Uint8Array {
  const rate = 44100;
  const n = Math.max(1, Math.round(seconds * rate));
  const data = new Int16Array(n);
  const bytes = data.byteLength;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(data.buffer)]));
}

function pictureDuration(shot: RenderManifest["shots"][number]): number {
  const trimmed = Math.max(0.4, shot.out_point_seconds - shot.in_point_seconds);
  return trimmed + (shot.hold_tail_seconds ?? 0);
}

function totalPicture(manifest: RenderManifest): number {
  if (manifest.shots.some((shot) => shot.picture_start_seconds != null)) {
    return manifest.shots.reduce((max, shot) => {
      const start = shot.picture_start_seconds ?? 0;
      return Math.max(max, start + pictureDuration(shot));
    }, 0);
  }
  return manifest.shots.reduce((sum, shot) => sum + pictureDuration(shot), 0);
}

function libraryStem(kind: "bed" | "sting" | "sfx", mood?: string | null): Uint8Array | null {
  const entry = pickMusic(kind, mood);
  return entry ? loadMusicBytes(entry) : null;
}

const DRAW_FONTS = [
  process.env.CAPTION_FONT_PATH ?? "",
  // Linux containers (worker/Dockerfile installs fonts-dejavu-core)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  // macOS dev machines
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
].filter(Boolean);

export function captionForceStyle(frameHeight = CAPTION_STYLE.canvas.height): string {
  const bandPct = (CAPTION_STYLE.bandFromTopPct.min + CAPTION_STYLE.bandFromTopPct.max) / 2;
  const marginV = Math.round(frameHeight * (1 - bandPct / 100));
  return `Fontsize=24,Alignment=2,MarginV=${marginV},Outline=3,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000`;
}

export function captionOverlayFilter(
  cues: Array<{ start: number; end: number }>,
): string {
  if (cues.length === 0) return "[0:v]format=yuv420p[vcap]";
  return cues
    .map((cue, index) => {
      const last = index === 0 ? "[0:v]" : `[vc${index - 1}]`;
      const out = index === cues.length - 1 ? "[vcap]" : `[vc${index}]`;
      return `${last}[${index + 1}:v]overlay=0:0:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'${out}`;
    })
    .join(";");
}

function captionFillRgb(text: string): [number, number, number] {
  const tag = /^([A-Z]{2,12}):/.exec(text.trim())?.[1] ?? "";
  const hex = speakerCaptionColor(tag).replace("#", "");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

async function renderCaptionPlate(file: string, text: string, frameHeight = CAPTION_STYLE.canvas.height): Promise<void> {
  const bandPct = (CAPTION_STYLE.bandFromTopPct.min + CAPTION_STYLE.bandFromTopPct.max) / 2;
  const y = Math.round(frameHeight * (bandPct / 100));
  const width = CAPTION_STYLE.canvas.width;
  const maxW = width - CAPTION_STYLE.keepOutLeftPx - CAPTION_STYLE.keepOutRightPx;
  const lines = wrapCaptionLines(text.replace(/\n/g, " "));
  const fill = captionFillRgb(text);
  const font = DRAW_FONTS.find((row) => existsSync(row)) ?? "";
  const script = join(file.replace(/[^/]+$/, ""), `plate-${Date.now()}-${Math.random().toString(16).slice(2)}.py`);
  await writeFile(
    script,
    `from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGBA", (${width}, ${frameHeight}), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype(${JSON.stringify(font)}, 36) if ${JSON.stringify(font)} else ImageFont.load_default()
except Exception:
    font = ImageFont.load_default()
lines = ${JSON.stringify(lines)}
max_w = ${maxW}
sizes = []
for line in lines:
    bbox = draw.textbbox((0, 0), line, font=font)
    sizes.append((bbox[2] - bbox[0], bbox[3] - bbox[1]))
while sizes and max(w for w, _ in sizes) > max_w:
    try:
        size = max(18, font.size - 2)
        font = ImageFont.truetype(${JSON.stringify(font)}, size)
    except Exception:
        break
    sizes = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        sizes.append((bbox[2] - bbox[0], bbox[3] - bbox[1]))
gap = 8
block_h = sum(h for _, h in sizes) + gap * max(0, len(sizes) - 1)
y0 = ${y} - block_h / 2
bottom = ${frameHeight} - ${CAPTION_STYLE.keepOutBottomPx}
if y0 + block_h > bottom:
    y0 = bottom - block_h
if y0 < ${frameHeight} * 0.62:
    y0 = ${frameHeight} * 0.62
cursor = y0
for line, (tw, th) in zip(lines, sizes):
    x = (${width} - min(tw, max_w)) / 2
    x = max(${CAPTION_STYLE.keepOutLeftPx}, min(x, ${width} - ${CAPTION_STYLE.keepOutRightPx} - tw))
    for dx, dy in ((-3,0),(3,0),(0,-3),(0,3),(-2,-2),(2,2),(-2,2),(2,-2)):
        draw.text((x+dx, cursor+dy), line, font=font, fill=(0,0,0,255))
    draw.text((x, cursor), line, font=font, fill=(${fill[0]},${fill[1]},${fill[2]},255))
    cursor += th + gap
img.save(${JSON.stringify(file)})
`,
  );
  await run("python3", [script]);
}

async function prepareClip(
  dir: string,
  index: number,
  body: Uint8Array,
  shot: RenderManifest["shots"][number] | undefined,
  keepAudio = false,
): Promise<string> {
  const raw = join(dir, `shot-${index}.mp4`);
  await writeFile(raw, body);
  const out = join(dir, `clip-${index}.mp4`);
  const inPoint = shot?.in_point_seconds ?? 0;
  const trimmed = Math.max(0.4, (shot?.out_point_seconds ?? inPoint + 4) - inPoint);
  const hold = shot?.hold_tail_seconds ?? 0;
  const vf = [
    "scale=720:1280:force_original_aspect_ratio=increase",
    "crop=720:1280",
    "eq=contrast=1.04:brightness=0.02:saturation=1.04:gamma=1.02",
    "fps=30",
    "format=yuv420p",
    hold > 0 ? `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}` : null,
  ]
    .filter(Boolean)
    .join(",");
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(inPoint),
    "-t",
    String(trimmed),
    "-i",
    raw,
    "-vf",
    vf,
    ...(keepAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    out,
  ]);
  return out;
}

export async function encodePortraitSlate(seconds = 2): Promise<Uint8Array | null> {
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-slate-"));
  const out = join(dir, "slate.mp4");
  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x1a1a1a:s=720x1280:d=${Math.max(0.4, seconds).toFixed(3)}:r=30`,
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-an",
      out,
    ]);
    return new Uint8Array(await readFile(out));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function concatClipFiles(
  dir: string,
  files: string[],
  outName: string,
  copy = false,
): Promise<string> {
  const listPath = join(dir, `${outName}.txt`);
  await writeFile(listPath, files.map((file) => `file '${file}'`).join("\n"));
  const out = join(dir, outName);
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    ...(copy
      ? ["-c", "copy"]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an"]),
    out,
  ]);
  return out;
}

/** Concat in 12-clip batches so a 15-min episode is not one in-memory bomb. */
export async function concatClipsIncremental(dir: string, clips: string[], batchSize = 12): Promise<string> {
  if (clips.length <= batchSize) return concatClipFiles(dir, clips, "picture.mp4");
  const batches: string[] = [];
  for (let i = 0; i < clips.length; i += batchSize) {
    batches.push(await concatClipFiles(dir, clips.slice(i, i + batchSize), `batch-${i}.mp4`));
  }
  return concatClipFiles(dir, batches, "picture.mp4", true);
}

function stingTimesMs(manifest: RenderManifest, total: number): number[] {
  const chapter = manifest.shots
    .filter((shot) => shot.sting)
    .map((shot) => Math.max(0, (shot.picture_start_seconds ?? 0) * 1000));
  const button = manifest.shots.find((shot) => shot.scene_kind === "button") ?? manifest.shots.at(-1);
  const end = Math.max(0, (button?.picture_start_seconds ?? total - 1.2) * 1000);
  return [...new Set([...chapter, end])].slice(0, 16);
}

export async function assembleEpisodeMp4(input: MixInput): Promise<Uint8Array | null> {
  if (!(await ffmpegAvailable())) return null;
  if (input.shotBodies.length === 0) return null;
  const looksLikeMp4 = input.shotBodies.every((body) => body.byteLength > 2_000 && body[4] === 0x66);
  if (!looksLikeMp4) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-mix-"));
  try {
    const shots = input.manifest.shots.map((shot) => ({ ...shot }));
    const originalStarts = shots.map((shot) => shot.picture_start_seconds ?? 0);
    const visemePads: number[] = [];
    // True when the pad was measured upstream (take analysis). Then the manifest
    // in-point is a settle trim that applies to picture AND native audio, and the
    // pad is a delay on top. False when the legacy auto-align path chose a
    // mouth-based picture trim that must not also skip the audio.
    const measuredPad: boolean[] = [];
    for (const [index, shot] of shots.entries()) {
      const lane = input.heardLanes?.[index] ?? shot.heard_audio ?? (shot.audio_role === "silent" ? "silent" : "tts");
      if (lane !== "native") {
        visemePads[index] = 0;
        measuredPad[index] = true;
        continue;
      }
      if (input.visemePadSeconds?.[index] != null) {
        visemePads[index] = Math.max(0, input.visemePadSeconds[index]!);
        measuredPad[index] = true;
        continue;
      }
      measuredPad[index] = false;
      const wanDialogue =
        input.visemeWanDialogue?.[index] ?? (shot.audio_role !== "offscreen" && shot.audio_role !== "silent");
      const audio = input.shotBodies[index] ?? input.nativeAudio?.[index];
      if (!audio) {
        visemePads[index] = 0;
        continue;
      }
      const plan = await visemeAlignForTake({
        video: input.shotBodies[index]!,
        audio,
        mouthOpenSeconds: input.visemeMouthOpenSeconds?.[index],
        voiceOnsetSeconds: input.visemeVoiceOnsetSeconds?.[index],
        wanDialogue,
        takeDurationSeconds: shot.out_point_seconds,
        existingInPointSeconds: shot.in_point_seconds,
      });
      shot.in_point_seconds = plan.pictureInPointSeconds;
      if (shot.out_point_seconds < shot.in_point_seconds + 0.4) {
        shot.out_point_seconds = shot.in_point_seconds + 0.4;
      }
      visemePads[index] = plan.audioDelayAfterTrimSeconds;
    }
    let pictureClock = 0;
    for (const shot of shots) {
      shot.picture_start_seconds = pictureClock;
      pictureClock += pictureDuration(shot);
    }
    const localManifest: RenderManifest = { ...input.manifest, shots };

    const clips: string[] = [];
    for (const [index, body] of input.shotBodies.entries()) {
      const lane = input.heardLanes?.[index] ?? shots[index]?.heard_audio;
      // Picture-only: native heard audio stays on the untrimmed take so a viseme
      // in-point does not also skip the delayed track (that recreates the gap).
      const clip = await prepareClip(dir, index, body, shots[index], shouldKeepTakeAudio(lane) && (shots[index]?.in_point_seconds ?? 0) < 0.02);
      clips.push(clip);
    }

    let picture = await concatClipsIncremental(dir, clips);
    if (input.vtt?.includes("-->")) {
      const cues = cuesFromVtt(input.vtt).map((cue) => {
        const idx = input.manifest.shots.findIndex((shot, index) => {
          const start = originalStarts[index] ?? shot.picture_start_seconds ?? 0;
          const end = start + Math.max(0.4, shot.out_point_seconds - shot.in_point_seconds) + (shot.hold_tail_seconds ?? 0);
          return cue.start >= start - 0.05 && cue.start < end + 0.05;
        });
        const pad = idx >= 0 ? visemePads[idx] ?? 0 : 0;
        const oldStart = idx >= 0 ? (originalStarts[idx] ?? 0) : 0;
        const newStart = idx >= 0 ? (shots[idx]?.picture_start_seconds ?? 0) : 0;
        const rel = cue.start - oldStart;
        return { ...cue, start: newStart + rel + pad, end: newStart + (cue.end - oldStart) + pad };
      });
      const plates: Array<{ file: string; start: number; end: number }> = [];
      for (const [index, cue] of cues.entries()) {
        const file = join(dir, `cap-${index}.png`);
        try {
          await renderCaptionPlate(file, cue.text);
          plates.push({ file, start: cue.start, end: cue.end });
        } catch {
          /* PIL missing — skip that plate */
        }
      }
      if (plates.length) {
        const captioned = join(dir, "picture-cap.mp4");
        const overlayArgs = ["-y", "-i", picture];
        for (const plate of plates) overlayArgs.push("-i", plate.file);
        overlayArgs.push(
          "-filter_complex",
          captionOverlayFilter(plates),
          "-map",
          "[vcap]",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-an",
          captioned,
        );
        await run("ffmpeg", overlayArgs);
        picture = captioned;
      }
    }

    const total = Math.max(8, totalPicture(localManifest));
    const mood = localManifest.shots.find((shot) => shot.music_mood)?.music_mood ?? "thriller";
    const bedBytes = libraryStem("bed", mood) ?? silentWav(total + 2);
    const stingBytes = libraryStem("sting", "impact") ?? silentWav(1.4);
    if (!libraryReady() && bedBytes.byteLength <= 100) {
      /* library missing: stay silent. Never synthesize a sine bed. */
    }
    const bed = join(dir, "bed.wav");
    const stinger = join(dir, "stinger.wav");
    await writeFile(bed, bedBytes);
    await writeFile(stinger, stingBytes);

    const stingAts = stingTimesMs(localManifest, total);

    const dialogueFiles: Array<{ file: string; delayMs: number }> = [];
    for (const [index, shot] of shots.entries()) {
      const lane = input.heardLanes?.[index] ?? shot.heard_audio ?? (shot.audio_role === "silent" ? "silent" : "tts");
      if (lane === "silent") continue;
      const native = lane === "native" ? (input.shotBodies[index] ?? input.nativeAudio?.[index]) : null;
      const body = heardBodyForShot(lane, native, input.ttsBodies?.[index]);
      if (!body) continue;
      const skip = heardFileSkipSeconds({
        lane,
        // Settle in-point trims picture and native audio by the same seconds; a
        // measured pad is then a delay on top. Only the legacy auto-align trim
        // (unmeasured pad) leaves the native track unskipped.
        inPointSeconds:
          lane === "native" && !measuredPad[index] && (visemePads[index] ?? 0) > 0.02 ? 0 : shot.in_point_seconds,
        leadingSilenceSeconds: 0,
      });
      const delay = heardDelaySeconds({
        pictureStartSeconds: shot.picture_start_seconds,
        audioStartSeconds: shot.audio_start_seconds,
        audioRole: shot.audio_role,
        inPointSeconds: 0,
        leadingSilenceSeconds: 0,
        visemePadSeconds: visemePads[index] ?? 0,
      });
      const file = join(dir, `dlg-${index}.wav`);
      const aligned = skip > 0.02 ? await trimHeardBytes(dir, index, body, skip) : body;
      if (skip > 0.02) {
        await writeFile(file, aligned);
      } else {
        const raw = join(dir, `heard-raw-${index}.bin`);
        await writeFile(raw, aligned);
        try {
          await run("ffmpeg", ["-y", "-i", raw, "-vn", "-ac", "1", "-ar", "44100", file]);
        } catch {
          await writeFile(file, aligned);
        }
      }
      dialogueFiles.push({ file, delayMs: Math.round(delay * 1000) });
    }

    const sfxFiles: Array<{ file: string; delayMs: number }> = [];
    for (const shot of localManifest.shots) {
      if (!shot.sfx && !shot.sting) continue;
      const bytes = libraryStem("sfx", shot.sfx ?? (shot.sting ? "impact" : null))
        ?? libraryStem("sting", shot.sfx ?? "comic");
      if (!bytes) continue;
      const file = join(dir, `sfx-${sfxFiles.length}.bin`);
      await writeFile(file, bytes);
      sfxFiles.push({ file, delayMs: Math.max(0, (shot.picture_start_seconds ?? 0) * 1000) });
    }

    const vttPath = join(dir, "captions.vtt");
    if (input.vtt?.includes("-->")) await writeFile(vttPath, input.vtt);

    const mixed = join(dir, "mixed.mp4");
    const args = ["-y", "-i", picture, "-stream_loop", "-1", "-i", bed, "-i", stinger];
    for (const row of dialogueFiles) args.push("-i", row.file);
    for (const row of sfxFiles) args.push("-i", row.file);
    const dlgOffset = 3;
    const dlg =
      dialogueFiles.length === 0
        ? "anullsrc=channel_layout=mono:sample_rate=44100,atrim=0:" + total.toFixed(3) + "[dlgraw]"
        : dialogueFiles
            .map((row, i) => `[${dlgOffset + i}:a]adelay=${Math.round(row.delayMs)}|${Math.round(row.delayMs)}[t${i}]`)
            .join(";") +
          ";" +
          dialogueFiles.map((_, i) => `[t${i}]`).join("") +
          `amix=inputs=${dialogueFiles.length}:normalize=0:dropout_transition=0[dlgraw]`;
    const sfxOffset = dlgOffset + dialogueFiles.length;
    const sfxGraph =
      sfxFiles.length === 0
        ? "anullsrc=channel_layout=mono:sample_rate=44100,atrim=0:0.2,volume=0[sfx]"
        : sfxFiles
            .map((row, i) => `[${sfxOffset + i}:a]adelay=${Math.round(row.delayMs)}|${Math.round(row.delayMs)},volume=1.8[x${i}]`)
            .join(";") +
          ";" +
          sfxFiles.map((_, i) => `[x${i}]`).join("") +
          `amix=inputs=${sfxFiles.length}:normalize=0:dropout_transition=0[sfx]`;
    const burn = "[0:v]format=yuv420p[v]";
    const stingGraph =
      stingAts.length <= 1
        ? `[2:a]adelay=${Math.round(stingAts[0] ?? 0)}|${Math.round(stingAts[0] ?? 0)},volume=1.8[sting]`
        : `[2:a]asplit=${stingAts.length}${stingAts.map((_, i) => `[ss${i}]`).join("")};` +
          stingAts
            .map((at, i) => `[ss${i}]adelay=${Math.round(at)}|${Math.round(at)},volume=1.8[st${i}]`)
            .join(";") +
          ";" +
          stingAts.map((_, i) => `[st${i}]`).join("") +
          `amix=inputs=${stingAts.length}:normalize=0:dropout_transition=0[sting]`;
    const duck = dialogueFiles.length ? 0.22 : 0.38;
    const spiked = localManifest.shots.some((shot) => shot.spike);
    const filter = [
      burn,
      `[1:a]atrim=0:${(total + 1).toFixed(3)},asetpts=PTS-STARTPTS,volume=${spiked ? Math.min(duck, 0.16) : duck}[bed]`,
      stingGraph,
      dlg,
      `[dlgraw]volume=1.4[dlg]`,
      sfxGraph,
      `[dlg][bed][sting][sfx]amix=inputs=4:normalize=0:dropout_transition=0,loudnorm=I=${LOUDNESS.mixLufs}:TP=${LOUDNESS.truePeakDb}[a]`,
    ].join(";");

    args.push("-filter_complex", filter, "-map", "[v]", "-map", "[a]");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-shortest", mixed);

    try {
      await run("ffmpeg", args);
      return new Uint8Array(await readFile(mixed));
    } catch (mixError) {
      if (process.env.SDM_DEBUG_MIX) {
        process.stderr.write(`mix failed: ${mixError instanceof Error ? mixError.message : mixError}\n`);
      }
      const fallback = join(dir, "fallback.mp4");
      try {
        await run("ffmpeg", [
          "-y",
          "-i",
          picture,
          "-i",
          bed,
          "-filter_complex",
          `[1:a]volume=0.16,loudnorm=I=${LOUDNESS.mixLufs}:TP=${LOUDNESS.truePeakDb}[a]`,
          "-map",
          "0:v",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          fallback,
        ]);
        return new Uint8Array(await readFile(fallback));
      } catch {
        await run("ffmpeg", ["-y", "-i", picture, "-c", "copy", fallback]);
        return new Uint8Array(await readFile(fallback));
      }
    }
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export { CAPTION_STYLE };
