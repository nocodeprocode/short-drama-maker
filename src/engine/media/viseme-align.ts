import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

/** Voice may start this far before the first mouth-open. Larger lead is delayed, not trimmed. */
export const VISEME_LEAD_TOLERANCE_SECONDS = 0.08;

/** Take already in sync: do not invent a Wan pad. */
export const ALIGNED_TAKE_TOLERANCE_SECONDS = 0.15;

/** Voice leading the mouth by this much is a real delay, not probe noise. */
export const VOICE_LEAD_PAD_MIN_SECONDS = 0.4;

/** Per-take heard delay is clamped so we do not overshoot into mouth-then-voice. */
export const VOICE_LEAD_PAD_MAX_SECONDS = 1.5;

/** Measured Wan audio-conditioned dialogue lag: native track leads visemes by ~1.2s. */
export const WAN_DIALOGUE_DEFAULT_PAD_SECONDS = 1.2;

/** Start picture this far before the assumed first mouth-open so we skip idle face. */
export const PICTURE_IN_LEAD_SECONDS = 0.15;

/** QC must not treat slate / still name-plants as the first dialogue line. */
export const DIALOGUE_ONSET_IGNORE_PLANTS_SECONDS = 4;

/** I2V dialogue CUs skip this much so the still→scene morph is never shown. */
export const I2V_SETTLE_DEFAULT_SECONDS = 1.5;

/** Longest still→scene settle we will cut from a dialogue CU. */
export const I2V_SETTLE_MAX_SECONDS = 3;

export function visemeAudioPadSeconds(input: {
  voiceOnsetSeconds: number | null | undefined;
  mouthOpenSeconds: number | null | undefined;
  motionPeakSeconds?: number | null;
  wanDialogue?: boolean;
  maxPadSeconds?: number;
}): number {
  const max = input.maxPadSeconds ?? 3.5;
  const wan = Boolean(input.wanDialogue);
  const voice = input.voiceOnsetSeconds;
  const mouthKnown = input.mouthOpenSeconds != null && Number.isFinite(input.mouthOpenSeconds);
  const mouth = input.mouthOpenSeconds;
  const voiceMissing = voice == null || !Number.isFinite(voice);
  if (mouthKnown && mouth != null) {
    if (voiceMissing) return 0;
    if (Math.abs(voice - mouth) <= ALIGNED_TAKE_TOLERANCE_SECONDS) return 0;
    if (voice >= mouth) return 0;
    const lead = mouth - voice;
    if (lead >= VOICE_LEAD_PAD_MIN_SECONDS) {
      return Math.min(max, Math.max(VOICE_LEAD_PAD_MIN_SECONDS, Math.min(VOICE_LEAD_PAD_MAX_SECONDS, lead)));
    }
    const pad = Math.max(0, mouth - VISEME_LEAD_TOLERANCE_SECONDS - voice);
    return Math.min(max, pad);
  }
  if (!wan) return 0;
  const v = voiceMissing ? 0 : voice;
  const motion = input.motionPeakSeconds;
  const voiceLeadsMotion =
    motion != null && Number.isFinite(motion) && v < motion - VISEME_LEAD_TOLERANCE_SECONDS;
  if (!voiceLeadsMotion) return 0;
  const pad = Math.max(WAN_DIALOGUE_DEFAULT_PAD_SECONDS, motion - VISEME_LEAD_TOLERANCE_SECONDS - v);
  return Math.min(max, Math.max(0, pad));
}

/**
 * Picture in-point that skips the I2V first-frame morph. Default 1.5s.
 * When vs-settled diffs are provided, cut at the first frame that already
 * looks like a late reference frame (room/pose stable). Never shorter than 1.5s.
 */
export function i2vSettleInPointSeconds(input?: {
  diffsVsSettled?: number[];
  hopSeconds?: number;
}): number {
  const hop = input?.hopSeconds ?? 0.1;
  const diffs = input?.diffsVsSettled;
  if (!diffs?.length) return I2V_SETTLE_DEFAULT_SECONDS;
  for (let i = 0; i < diffs.length; i += 1) {
    if ((diffs[i] ?? 999) <= 14) {
      return Math.min(
        I2V_SETTLE_MAX_SECONDS,
        Math.max(I2V_SETTLE_DEFAULT_SECONDS, Number((i * hop).toFixed(2))),
      );
    }
  }
  return I2V_SETTLE_MAX_SECONDS;
}

export function visemeAlignPlan(input: {
  voiceOnsetSeconds?: number | null;
  mouthOpenSeconds?: number | null;
  motionPeakSeconds?: number | null;
  wanDialogue?: boolean;
  takeDurationSeconds?: number;
  existingInPointSeconds?: number;
}): { padSeconds: number; pictureInPointSeconds: number; audioDelayAfterTrimSeconds: number } {
  const wan = Boolean(input.wanDialogue);
  const voice = input.voiceOnsetSeconds ?? (wan ? 0 : null);
  const pad = visemeAudioPadSeconds({
    voiceOnsetSeconds: voice,
    mouthOpenSeconds: input.mouthOpenSeconds,
    motionPeakSeconds: input.motionPeakSeconds,
    wanDialogue: wan,
  });
  const assumedMouth =
    input.mouthOpenSeconds ??
    (wan && pad > 0 ? (input.voiceOnsetSeconds ?? 0) + WAN_DIALOGUE_DEFAULT_PAD_SECONDS : 0);
  const rawIn = assumedMouth > 0 ? Math.max(0, assumedMouth - PICTURE_IN_LEAD_SECONDS) : 0;
  const maxIn = Math.max(0, (input.takeDurationSeconds ?? 6) - 0.8);
  // Native audio is not skipped with the picture in-point. Only trim idle face when
  // we actually padded a take-head Wan lead.
  const pictureIn =
    pad > 0 && (voice ?? 0) <= 0.25
      ? Math.min(Math.max(rawIn, input.existingInPointSeconds ?? 0), maxIn)
      : (input.existingInPointSeconds ?? 0);
  return {
    padSeconds: pad,
    pictureInPointSeconds: pictureIn,
    audioDelayAfterTrimSeconds: Math.max(0, pad - pictureIn),
  };
}

export function firstVoicedSecond(
  samples: ArrayLike<number>,
  rate: number,
  skipSeconds = 0,
): number | null {
  if (rate <= 0 || samples.length < rate * 0.04) return null;
  const hop = Math.max(1, Math.round(rate * 0.01));
  const skip = Math.max(0, Math.round(skipSeconds * rate));
  if (skip >= samples.length) return null;
  const windows: number[] = [];
  for (let i = skip; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j += 1) sum += (samples[i + j] ?? 0) ** 2;
    windows.push(Math.sqrt(sum / hop));
  }
  const ranked = [...windows].sort((a, b) => a - b);
  const quiet = ranked[Math.floor(ranked.length * 0.2)] ?? 0;
  const floor = Math.max(700, quiet * 4);
  let run = 0;
  for (let i = 0; i < windows.length; i += 1) {
    if ((windows[i] ?? 0) >= floor) {
      run += 1;
      if (run >= 4) return Number(((skip + (i - 3) * hop) / rate).toFixed(3));
    } else {
      run = 0;
    }
  }
  return null;
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve({ ok: false, stdout: Buffer.alloc(0) }));
    child.on("exit", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(chunks) }));
  });
}

export async function firstVoicedSecondFromBytes(body: Uint8Array): Promise<number | null> {
  if (body.byteLength < 64 || !(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-voice-"));
  const raw = join(dir, "in.bin");
  const wav = join(dir, "out.wav");
  try {
    await writeFile(raw, body);
    const ok = await run("ffmpeg", ["-y", "-i", raw, "-ac", "1", "-ar", "16000", "-f", "wav", wav]);
    if (!ok.ok) return null;
    const pcm = await readFile(wav);
    if (pcm.byteLength < 44) return null;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset + 44, Math.floor((pcm.byteLength - 44) / 2));
    return firstVoicedSecond(samples, 16000);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MOUTH_W = 48;
const MOUTH_H = 28;

/** Lower-center of the face still region (mouth), not a mid-face crop that misses visemes. */
const MOUTH_CROP = `crop=iw*0.30:ih*0.12:(iw-iw*0.30)/2:ih*0.54,scale=${MOUTH_W}:${MOUTH_H},format=gray`;

export async function firstMouthOpenSecond(video: Uint8Array): Promise<number | null> {
  if (video.byteLength < 2_000 || !(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-mouth-"));
  const input = join(dir, "take.mp4");
  try {
    await writeFile(input, video);
    const raw = await run("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vf",
      `fps=10,${MOUTH_CROP}`,
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    if (!raw.ok || raw.stdout.byteLength < MOUTH_W * MOUTH_H) return null;
    const frameSize = MOUTH_W * MOUTH_H;
    const frames = Math.floor(raw.stdout.byteLength / frameSize);
    const darks: number[] = [];
    const means: number[] = [];
    for (let f = 0; f < frames; f += 1) {
      let sum = 0;
      let dark = 0;
      const offset = f * frameSize;
      for (let i = 0; i < frameSize; i += 1) {
        const v = raw.stdout[offset + i] ?? 0;
        sum += v;
        if (v < 70) dark += 1;
      }
      means.push(sum / frameSize);
      darks.push(dark / frameSize);
    }
    const baseN = Math.min(4, means.length);
    const baseMean = means.slice(0, baseN).reduce((a, b) => a + b, 0) / baseN;
    const baseDark = darks.slice(0, baseN).reduce((a, b) => a + b, 0) / baseN;
    for (let f = 3; f < frames; f += 1) {
      const dark = darks[f] ?? 0;
      const mean = means[f] ?? 255;
      const prev = darks[f - 1] ?? 0;
      const open =
        (dark > baseDark + 0.08 && mean < baseMean - 8 && prev > baseDark + 0.03) ||
        dark > baseDark + 0.16;
      if (open) return Number((f / 10).toFixed(3));
    }
    return null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Coarse lower-face motion peak — used to raise the Wan pad when the mouth probe is late or missing. */
export async function coarseMotionPeakSecond(video: Uint8Array): Promise<number | null> {
  if (video.byteLength < 2_000 || !(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-motion-"));
  const input = join(dir, "take.mp4");
  try {
    await writeFile(input, video);
    const raw = await run("ffmpeg", [
      "-y",
      "-i",
      input,
      "-vf",
      `fps=8,crop=iw*0.40:ih*0.18:(iw-iw*0.40)/2:ih*0.48,scale=40:22,format=gray`,
      "-f",
      "rawvideo",
      "pipe:1",
    ]);
    const frameSize = 40 * 22;
    if (!raw.ok || raw.stdout.byteLength < frameSize * 3) return null;
    const frames = Math.floor(raw.stdout.byteLength / frameSize);
    const diffs: number[] = [0];
    for (let f = 1; f < frames; f += 1) {
      let acc = 0;
      const a = (f - 1) * frameSize;
      const b = f * frameSize;
      for (let i = 0; i < frameSize; i += 1) acc += Math.abs((raw.stdout[b + i] ?? 0) - (raw.stdout[a + i] ?? 0));
      diffs.push(acc / frameSize);
    }
    const usable = diffs.slice(3);
    if (!usable.length) return null;
    const ranked = [...usable].sort((a, b) => a - b);
    const median = ranked[Math.floor(ranked.length / 2)] ?? 0;
    let peak = 0;
    let peakAt = -1;
    for (let i = 3; i < diffs.length; i += 1) {
      const d = diffs[i] ?? 0;
      if (d > peak) {
        peak = d;
        peakAt = i;
      }
    }
    if (peakAt < 0 || peak < Math.max(4, median * 1.8)) return null;
    return Number((peakAt / 8).toFixed(3));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function visemeAlignForTake(input: {
  video: Uint8Array;
  audio: Uint8Array;
  mouthOpenSeconds?: number | null;
  voiceOnsetSeconds?: number | null;
  motionPeakSeconds?: number | null;
  wanDialogue?: boolean;
  takeDurationSeconds?: number;
  existingInPointSeconds?: number;
}): Promise<{ padSeconds: number; pictureInPointSeconds: number; audioDelayAfterTrimSeconds: number }> {
  const mouth =
    input.mouthOpenSeconds != null ? input.mouthOpenSeconds : await firstMouthOpenSecond(input.video);
  const detected =
    input.voiceOnsetSeconds != null ? input.voiceOnsetSeconds : await firstVoicedSecondFromBytes(input.audio);
  const voice = detected ?? (mouth != null || input.wanDialogue ? 0 : null);
  const motion =
    input.motionPeakSeconds !== undefined
      ? input.motionPeakSeconds
      : input.wanDialogue
        ? await coarseMotionPeakSecond(input.video)
        : null;
  return visemeAlignPlan({
    voiceOnsetSeconds: voice,
    mouthOpenSeconds: mouth,
    motionPeakSeconds: motion,
    wanDialogue: input.wanDialogue,
    takeDurationSeconds: input.takeDurationSeconds,
    existingInPointSeconds: input.existingInPointSeconds,
  });
}

export async function visemePadForTake(input: {
  video: Uint8Array;
  audio: Uint8Array;
  mouthOpenSeconds?: number | null;
  wanDialogue?: boolean;
}): Promise<number> {
  const plan = await visemeAlignForTake(input);
  return plan.padSeconds;
}
