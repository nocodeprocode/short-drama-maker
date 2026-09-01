import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInternalCuts, ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { probeVideoBytes } from "../media/probe.ts";
import { inventedSecondBody } from "../media/second-body.ts";
import {
  ALIGNED_TAKE_TOLERANCE_SECONDS,
  firstMouthOpenSecond,
  firstVoicedSecondFromBytes,
  I2V_SETTLE_MAX_SECONDS,
  visemeAudioPadSeconds,
  VOICE_LEAD_PAD_MAX_SECONDS,
} from "../media/viseme-align.ts";

/**
 * Everything the cut needs to know about one generated take, measured once at
 * ingest and persisted on the shot. This is the automated form of the hand
 * constants in the lock-v9 script (settle 3.0s, mouth 3.4s, sheer gate).
 */
export type TakeAnalysis = {
  version: 2;
  duration_seconds: number;
  has_audio: boolean;
  /** First frame where the picture already matches its settled self. 0 = no visible morph. */
  settle_in_seconds: number;
  /** Frame-vs-settled-reference diffs sampled every `settle_hop_seconds`, for audits. */
  settle_hop_seconds: number;
  settle_diffs: number[];
  mouth_open_seconds: number | null;
  voice_onset_seconds: number | null;
  /** voice − mouth in ms. Negative = voice leads the mouth (needs a pad). */
  sync_lag_ms: number | null;
  /** Audio delay the mixer should apply so voice does not lead the lips. */
  viseme_pad_seconds: number;
  internal_cut_count: number;
  second_body: boolean;
  chest_skin_fraction: number | null;
  modest_reference_fraction: number | null;
  sheer_or_bra: boolean;
  /** Set by the identity stage (face embedding); null until it runs. */
  face_similarity: number | null;
  face_count: number | null;
  measured_at: string;
};

export type TakeAnalysisInput = {
  video: Uint8Array;
  /** Locked CU still the take was conditioned on (used for second-body and modesty baselines). */
  still?: Uint8Array | null;
  /** Modest reference still for the pictured character; defaults to `still`. */
  modestStill?: Uint8Array | null;
  /** Dialogue CU with native Wan audio; enables mouth/voice probes and the modesty gate. */
  dialogueCu: boolean;
  wanDialogue?: boolean;
  /** Skip the picture probes (tests, non-ffmpeg environments). */
  skipPixels?: boolean;
  now?: () => string;
};

/** A frame this close (mean abs gray diff, 0–255) to the settled reference counts as settled. */
export const SETTLE_MATCH_THRESHOLD = 14;
/** Frames start diverging from a still this quickly; below this the take never morphed. */
export const SETTLE_NO_MORPH_THRESHOLD = 10;
export const SETTLE_HOP_SECONDS = 0.1;
/** How far into the take the settled reference is sampled. */
export const SETTLE_REFERENCE_SECONDS = 3.5;
/** Mouth may lag voice by this much before we pad; anything bigger is a real lead. */
export const SYNC_PAD_TRIGGER_MS = 120;
/** Ship gate on the final cut, per line. */
export const SYNC_SHIP_LIMIT_MS = 80;

const GRAY_W = 90;
const GRAY_H = 160;

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve({ ok: false, stdout: Buffer.alloc(0) }));
    child.on("exit", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(chunks) }));
  });
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / n;
}

/**
 * Pure settle detector. `diffsVsSettled[i]` is the gray diff between the frame
 * at `i * hop` seconds and the settled reference frame.
 *
 * - First frame already settled → 0 (Seedance-style take, nothing to trim).
 * - Otherwise the first frame under the match threshold, capped at the I2V max.
 * - Never settles → cap (the take is a slow morph; the mixer will trim the max).
 */
export function settleInPointFromDiffs(diffsVsSettled: readonly number[], hop = SETTLE_HOP_SECONDS): number {
  if (!diffsVsSettled.length) return 0;
  if ((diffsVsSettled[0] ?? 999) <= SETTLE_NO_MORPH_THRESHOLD) return 0;
  for (let i = 0; i < diffsVsSettled.length; i += 1) {
    if ((diffsVsSettled[i] ?? 999) <= SETTLE_MATCH_THRESHOLD) {
      // Require the next frame to agree so a single lucky frame mid-morph does not win.
      const next = diffsVsSettled[i + 1];
      if (next == null || next <= SETTLE_MATCH_THRESHOLD + 4) {
        return Math.min(I2V_SETTLE_MAX_SECONDS, Number((i * hop).toFixed(2)));
      }
    }
  }
  return I2V_SETTLE_MAX_SECONDS;
}

/** Gray frames at `hop` over [0, seconds] from an on-disk take. */
async function grayFrames(path: string, seconds: number, hop: number): Promise<Uint8Array[]> {
  const fps = Math.round(1 / hop);
  const raw = await run("ffmpeg", [
    "-y",
    "-t",
    seconds.toFixed(2),
    "-i",
    path,
    "-vf",
    `fps=${fps},scale=${GRAY_W}:${GRAY_H},format=gray`,
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const size = GRAY_W * GRAY_H;
  if (!raw.ok || raw.stdout.byteLength < size) return [];
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + size <= raw.stdout.byteLength; offset += size) {
    frames.push(new Uint8Array(raw.stdout.buffer, raw.stdout.byteOffset + offset, size));
  }
  return frames;
}

const MOUTH_W = 48;
const MOUTH_H = 28;
const MOUTH_FPS = 20;

/**
 * Fallback mouth-open probe: first sustained burst of motion inside the mouth
 * crop after the settle point. Wardrobe- and lighting-agnostic, unlike the
 * darkness-based probe in viseme-align, which misses on dark-knit takes.
 */
export async function mouthMotionOnsetSecond(path: string, fromSeconds: number, durationSeconds: number): Promise<number | null> {
  const span = Math.max(0.5, durationSeconds - fromSeconds);
  const raw = await run("ffmpeg", [
    "-y",
    "-ss",
    fromSeconds.toFixed(2),
    "-t",
    span.toFixed(2),
    "-i",
    path,
    "-vf",
    `fps=${MOUTH_FPS},crop=iw*0.30:ih*0.12:(iw-iw*0.30)/2:ih*0.54,scale=${MOUTH_W}:${MOUTH_H},format=gray`,
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const size = MOUTH_W * MOUTH_H;
  if (!raw.ok || raw.stdout.byteLength < size * 6) return null;
  const frames = Math.floor(raw.stdout.byteLength / size);
  const diffs: number[] = [];
  for (let f = 1; f < frames; f += 1) {
    const a = raw.stdout.subarray((f - 1) * size, f * size);
    const b = raw.stdout.subarray(f * size, (f + 1) * size);
    diffs.push(meanAbsDiff(a, b));
  }
  // Most of the post-settle window is speech, so a median floor hides the onset.
  // Anchor on the quiet quantile the same way the voice probe does.
  const ranked = [...diffs].sort((x, y) => x - y);
  const quiet = ranked[Math.floor(ranked.length * 0.2)] ?? 0;
  const floor = Math.max(2.5, quiet * 3);
  let runLength = 0;
  for (let i = 0; i < diffs.length; i += 1) {
    if ((diffs[i] ?? 0) >= floor) {
      runLength += 1;
      if (runLength >= 3) return Number((fromSeconds + (i - 2) / MOUTH_FPS).toFixed(3));
    } else {
      runLength = 0;
    }
  }
  return null;
}

export async function measureSettle(
  path: string,
  durationSeconds: number,
): Promise<{ settle_in_seconds: number; diffs: number[] }> {
  const span = Math.min(SETTLE_REFERENCE_SECONDS, Math.max(0.5, durationSeconds - 0.3));
  const frames = await grayFrames(path, span + SETTLE_HOP_SECONDS, SETTLE_HOP_SECONDS);
  if (frames.length < 3) return { settle_in_seconds: 0, diffs: [] };
  const reference = frames[frames.length - 1]!;
  const diffs = frames.slice(0, -1).map((frame) => Number(meanAbsDiff(frame, reference).toFixed(2)));
  return { settle_in_seconds: settleInPointFromDiffs(diffs), diffs };
}

/**
 * Fraction of "skin" pixels in the chest band of a portrait frame. Compared
 * against the same measure on the modest reference still: a sheer top or bra
 * reads as a large jump. Ported from the lock-v9 audit.
 */
export function chestSkinFraction(rgb: Uint8Array, width: number, height: number): number {
  const x0 = Math.round(width * 0.28);
  const x1 = Math.round(width * 0.72);
  const y0 = Math.round(height * 0.42);
  const y1 = Math.round(height * 0.64);
  let skin = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * width + x) * 3;
      const r = rgb[o] ?? 0;
      const g = rgb[o + 1] ?? 0;
      const b = rgb[o + 2] ?? 0;
      n += 1;
      if (r > 90 && r > g + 8 && r > b + 6 && g > 45 && b > 35 && r < 240) skin += 1;
    }
  }
  return n ? skin / n : 0;
}

/**
 * Relative gate only. On a CU the band is mostly neck and jaw, so an absolute
 * threshold is meaningless; the signal is the jump versus the same character's
 * modest reference still. No reference → no verdict.
 */
export function sheerOrBra(chest: number | null, modestReference: number | null): boolean {
  if (chest == null || modestReference == null) return false;
  return chest > modestReference + 0.18 && chest > 0.22;
}

const CHEST_W = 180;
const CHEST_H = 320;

async function rgbFrame(path: string, kind: "image" | "video", ss: number): Promise<Uint8Array | null> {
  const raw = await run("ffmpeg", [
    "-y",
    ...(kind === "video" ? ["-ss", ss.toFixed(2)] : []),
    "-i",
    path,
    "-vf",
    `scale=${CHEST_W}:${CHEST_H},format=rgb24`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const size = CHEST_W * CHEST_H * 3;
  return raw.ok && raw.stdout.byteLength >= size ? new Uint8Array(raw.stdout.subarray(0, size)) : null;
}

export function syncLagMs(voice: number | null, mouth: number | null): number | null {
  if (voice == null || mouth == null) return null;
  return Math.round((voice - mouth) * 1000);
}

/**
 * Pad only when the voice measurably leads the mouth by more than the trigger;
 * otherwise 0, so in-sync Seedance/Wan takes are never delayed on a guess.
 */
export function padFromSync(input: {
  voice: number | null;
  mouth: number | null;
  wanDialogue: boolean;
}): number {
  const lag = syncLagMs(input.voice, input.mouth);
  if (lag == null) return 0;
  if (lag >= -SYNC_PAD_TRIGGER_MS) return 0;
  return visemeAudioPadSeconds({
    voiceOnsetSeconds: input.voice,
    mouthOpenSeconds: input.mouth,
    wanDialogue: input.wanDialogue,
  });
}

export async function analyzeTake(input: TakeAnalysisInput): Promise<TakeAnalysis> {
  const now = input.now ?? (() => new Date().toISOString());
  const probe = probeVideoBytes(input.video);
  const base: TakeAnalysis = {
    version: 2,
    duration_seconds: probe.duration_seconds,
    has_audio: probe.has_audio,
    settle_in_seconds: 0,
    settle_hop_seconds: SETTLE_HOP_SECONDS,
    settle_diffs: [],
    mouth_open_seconds: null,
    voice_onset_seconds: null,
    sync_lag_ms: null,
    viseme_pad_seconds: 0,
    internal_cut_count: 0,
    second_body: false,
    chest_skin_fraction: null,
    modest_reference_fraction: null,
    sheer_or_bra: false,
    face_similarity: null,
    face_count: null,
    measured_at: now(),
  };
  if (input.skipPixels || input.video.byteLength < 2_000 || !(await ffmpegAvailable())) return base;

  const dir = await mkdtemp(join(tmpdir(), "sdm-take-"));
  try {
    const take = join(dir, "take.mp4");
    await writeFile(take, input.video);

    const settle = await measureSettle(take, probe.duration_seconds);
    base.settle_in_seconds = settle.settle_in_seconds;
    base.settle_diffs = settle.diffs;

    // Scene-change detection must start after the morph, or the settle itself counts as a cut.
    const cuts = await detectInternalCuts(input.video, 0.3, { skipSeconds: base.settle_in_seconds + 0.2 });
    base.internal_cut_count = cuts.internal_cut_count;

    if (input.dialogueCu) {
      const [darkMouth, voice] = await Promise.all([
        firstMouthOpenSecond(input.video),
        probe.has_audio ? firstVoicedSecondFromBytes(input.video) : Promise.resolve(null),
      ]);
      // Speech-driven mouth motion cannot lead the voice by more than the pad ceiling,
      // and residual head motion right after the settle is not a viseme.
      const searchFrom = Math.max(
        base.settle_in_seconds + 0.3,
        voice != null ? voice - VOICE_LEAD_PAD_MAX_SECONDS : 0,
      );
      const mouth =
        darkMouth != null && darkMouth >= searchFrom
          ? darkMouth
          : await mouthMotionOnsetSecond(take, searchFrom, probe.duration_seconds);
      base.mouth_open_seconds = mouth;
      base.voice_onset_seconds = voice;
      base.sync_lag_ms = syncLagMs(voice, mouth);
      base.viseme_pad_seconds = padFromSync({ voice, mouth, wanDialogue: input.wanDialogue ?? true });

      base.second_body = await inventedSecondBody(input.video, input.still ?? null);

      const modest = input.modestStill ?? input.still ?? null;
      if (modest && modest.byteLength > 32) {
        const stillPath = join(dir, "modest.png");
        await writeFile(stillPath, modest);
        const reference = await rgbFrame(stillPath, "image", 0);
        base.modest_reference_fraction = reference ? Number(chestSkinFraction(reference, CHEST_W, CHEST_H).toFixed(3)) : null;
      }
      const checkAt = Math.max(base.settle_in_seconds + 0.1, voice ?? mouth ?? base.settle_in_seconds + 0.5);
      const frame = await rgbFrame(take, "video", Math.min(checkAt, Math.max(0, probe.duration_seconds - 0.2)));
      base.chest_skin_fraction = frame ? Number(chestSkinFraction(frame, CHEST_W, CHEST_H).toFixed(3)) : null;
      base.sheer_or_bra = sheerOrBra(base.chest_skin_fraction, base.modest_reference_fraction);
    }
    return base;
  } catch {
    return base;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type TakeVerdict = {
  /** 0–100; higher is a better take. Only meaningful among takes of the same shot. */
  score: number;
  blockers: string[];
  warnings: string[];
};

export type TakeScoreContext = {
  dialogueCu: boolean;
  lockedTake: boolean;
  expectedDurationSeconds?: number | null;
  faceSimilarityFloor?: number;
  /** People the plan put in frame; a measured face_count that differs is a blocker. */
  expectedFaces?: number | null;
};

/** Cosine similarity below this reads as a different person. Tuned for ArcFace-style embeddings. */
export const FACE_SIMILARITY_FLOOR = 0.55;

export function scoreTake(analysis: TakeAnalysis, context: TakeScoreContext): TakeVerdict {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  if (context.dialogueCu && !analysis.has_audio) blockers.push("native_audio_missing");
  if (analysis.second_body) blockers.push("invented_people");
  if (analysis.sheer_or_bra) blockers.push("modest_dress");
  if (context.lockedTake && analysis.internal_cut_count > 0) blockers.push("internal_cut");
  if (analysis.face_similarity != null && analysis.face_similarity < (context.faceSimilarityFloor ?? FACE_SIMILARITY_FLOOR)) {
    blockers.push("identity_drift");
  }
  const expectedFaces = context.expectedFaces ?? (context.dialogueCu ? 1 : null);
  if (expectedFaces != null && analysis.face_count != null && analysis.face_count !== expectedFaces) {
    blockers.push("invented_people");
  }

  const usable = analysis.duration_seconds - analysis.settle_in_seconds;
  if (analysis.duration_seconds > 0 && usable < 1.5) blockers.push("settle_eats_take");
  if (analysis.settle_in_seconds >= I2V_SETTLE_MAX_SECONDS) {
    warnings.push("slow_settle");
    score -= 15;
  }
  score -= Math.min(20, analysis.settle_in_seconds * 6);

  if (context.dialogueCu) {
    if (analysis.mouth_open_seconds == null) {
      warnings.push("mouth_open_unknown");
      score -= 10;
    }
    if (analysis.voice_onset_seconds == null) {
      warnings.push("voice_onset_unknown");
      score -= 10;
    }
    if (analysis.sync_lag_ms != null) {
      const abs = Math.abs(analysis.sync_lag_ms);
      if (abs > SYNC_SHIP_LIMIT_MS && analysis.viseme_pad_seconds === 0) {
        // Mouth leads voice: nothing the mixer can do without cutting picture.
        if (analysis.sync_lag_ms > 0) {
          if (abs > 400) blockers.push("mouth_leads_voice");
          else warnings.push("mouth_leads_voice");
        }
      }
      score -= Math.min(25, abs / 20);
    }
    if (analysis.viseme_pad_seconds > 0) {
      warnings.push("voice_leads_mouth_padded");
      score -= Math.min(15, analysis.viseme_pad_seconds * 10);
    }
    if (analysis.mouth_open_seconds != null && analysis.mouth_open_seconds < analysis.settle_in_seconds) {
      // The mouth opened while the room was still morphing: the trimmed cut loses the first syllable.
      blockers.push("speaks_before_settle");
    }
  }
  if (analysis.face_similarity != null) {
    score -= Math.round((1 - analysis.face_similarity) * 30);
  }
  if (context.expectedDurationSeconds && analysis.duration_seconds > 0) {
    const off = Math.abs(analysis.duration_seconds - context.expectedDurationSeconds);
    if (off > 2) warnings.push("duration_mismatch");
    score -= Math.min(10, off * 3);
  }

  return { score: Math.max(0, Math.round(score)), blockers: [...new Set(blockers)], warnings };
}

/** Highest score among takes with no blockers; null when none is shippable. */
export function pickBestTake<T extends { verdict: TakeVerdict }>(takes: readonly T[]): T | null {
  const clean = takes.filter((take) => take.verdict.blockers.length === 0);
  if (!clean.length) return null;
  return clean.reduce((best, take) => (take.verdict.score > best.verdict.score ? take : best));
}

export { ALIGNED_TAKE_TOLERANCE_SECONDS };
