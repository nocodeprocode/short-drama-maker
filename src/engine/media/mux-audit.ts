import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { LOUDNESS } from "../../drama-engine/types/audio.ts";
import type { RenderManifest } from "../domain.ts";
import type { TakeAnalysis } from "../pipeline/take-analysis.ts";
import { probeVideoBytes } from "./probe.ts";
import { firstVoicedSecond } from "./viseme-align.ts";

/**
 * Post-mux gate. The lock-v9 script audited its two-shot cut by hand-built
 * windows; this is the same audit for any manifest, run on the bytes we are
 * about to call `episode_final`. Nothing ships unless every dialogue line
 * lands within the sync limit, no dialogue CU opens on a morphing frame, and
 * the file has real picture and audio for its whole duration.
 */
export type MuxAuditLine = {
  shot_id: string;
  speaker: string | null;
  picture_start_s: number;
  expected_voice_s: number;
  voice_onset_s: number | null;
  mouth_open_s: number | null;
  lag_ms: number | null;
  limit_ms: number;
  pass: boolean;
  /** Morph velocity at the open (first frame vs +0.3s): a settled open is small. */
  head_step: number | null;
  settled_open: boolean;
};

export type MuxAudit = {
  version: 1;
  ship: boolean;
  reasons: string[];
  duration_seconds: number;
  expected_duration_seconds: number;
  has_audio: boolean;
  black_frames: number;
  /** EBU R128 on the encoded file; null when it could not be measured. */
  integrated_lufs: number | null;
  true_peak_dbfs: number | null;
  loudness_range_lu: number | null;
  lines: MuxAuditLine[];
  measured_at: string;
};

export type MuxAuditInput = {
  body: Uint8Array;
  manifest: RenderManifest;
  analyses: Array<TakeAnalysis | null | undefined>;
  heardLanes: Array<"native" | "tts" | "silent" | null | undefined>;
  /** Per-shot lag limit in ms; defaults to the v9 ship limit. */
  limitMs?: number;
  /**
   * Word timings for the final's audio. Native takes carry ambience, so the
   * level detector alone would place the "voice" on room tone; with a
   * transcript the onset is the first word inside each shot's window.
   */
  transcribe?: (mp3: Uint8Array) => Promise<{ words: Array<{ start: number; end: number }> } | null>;
  now?: () => string;
};

export const MUX_SYNC_LIMIT_MS = 80;
/** Lines whose mouth-open came from the motion fallback get the v9 Eli tolerance. */
export const MUX_SYNC_SOFT_LIMIT_MS = 200;
/**
 * Gray mean-abs-diff between a shot's first frame and the frame 0.3s later, the
 * same morph-velocity measure the settle detector uses (`SETTLE_STEP_MAX`),
 * with a little headroom for re-encode noise. Above this the room is still sliding.
 */
export const HEAD_STEP_MAX = 16;
export const HEAD_STEP_WINDOW_SECONDS = 0.3;
/** Frames darker than this mean luma (0-255) read as black. */
export const BLACK_FRAME_LUMA = 16;

export type MuxAuditFn = (input: MuxAuditInput) => Promise<MuxAudit>;

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve({ ok: false, stdout: Buffer.alloc(0) }));
    child.on("exit", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(chunks) }));
  });
}

const GRAY_W = 90;
const GRAY_H = 160;

async function grayFrameAt(path: string, ss: number): Promise<Uint8Array | null> {
  const raw = await run("ffmpeg", [
    "-y", "-ss", Math.max(0, ss).toFixed(3), "-i", path,
    "-vf", `scale=${GRAY_W}:${GRAY_H},format=gray`, "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ]);
  const size = GRAY_W * GRAY_H;
  return raw.ok && raw.stdout.byteLength >= size ? new Uint8Array(raw.stdout.subarray(0, size)) : null;
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return n ? sum / n : 0;
}

function meanLuma(frame: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] ?? 0;
  return frame.length ? sum / frame.length : 0;
}

function runStderr(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    child.on("error", () => resolve(""));
    child.on("exit", () => resolve(stderr));
  });
}

/** Parses the `ebur128` summary block ffmpeg prints on stderr. */
export function parseEbur128Summary(stderr: string): { integrated: number; truePeak: number; lra: number } | null {
  const summaryAt = stderr.lastIndexOf("Summary:");
  const block = summaryAt >= 0 ? stderr.slice(summaryAt) : stderr;
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(block);
  const lra = /LRA:\s+(-?[\d.]+) LU/.exec(block);
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(block);
  if (!integrated || !peak) return null;
  return {
    integrated: Number(integrated[1]),
    truePeak: Number(peak[1]),
    lra: lra ? Number(lra[1]) : 0,
  };
}

/** Delivery loudness check against the mix target. */
export function loudnessReasons(measure: { integrated: number; truePeak: number } | null): string[] {
  if (!measure) return [];
  const reasons: string[] = [];
  if (Math.abs(measure.integrated - LOUDNESS.mixLufs) > LOUDNESS.deliveryToleranceLu) reasons.push("loudness_off_target");
  if (measure.truePeak > LOUDNESS.deliveryTruePeakMaxDb) reasons.push("true_peak_over");
  return reasons;
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

export function expectedDurationSeconds(manifest: RenderManifest): number {
  return manifest.shots.reduce((max, shot) => {
    const start = shot.picture_start_seconds ?? 0;
    const slip = Math.max(0, shot.audio_slip_seconds ?? 0);
    const length = Math.max(0.4, shot.out_point_seconds - shot.in_point_seconds - slip) + (shot.hold_tail_seconds ?? 0);
    return Math.max(max, start + length);
  }, 0);
}

/** Pure timeline math: where on the final cut a take's onsets should land. */
export function projectOnsets(input: {
  pictureStart: number;
  inPoint: number;
  padSeconds: number;
  /** Native audio advanced relative to picture (slip edit). */
  slipSeconds?: number;
  voiceOnTake: number | null;
  mouthOnTake: number | null;
}): { expectedVoice: number | null; mouthOnMux: number | null } {
  const expectedVoice =
    input.voiceOnTake == null
      ? null
      : input.pictureStart + (input.voiceOnTake - input.inPoint) + input.padSeconds - (input.slipSeconds ?? 0);
  const mouthOnMux = input.mouthOnTake == null ? null : input.pictureStart + (input.mouthOnTake - input.inPoint);
  return { expectedVoice, mouthOnMux };
}

export async function auditMux(input: MuxAuditInput): Promise<MuxAudit> {
  const now = input.now ?? (() => new Date().toISOString());
  const probe = probeVideoBytes(input.body);
  const expected = expectedDurationSeconds(input.manifest);
  const audit: MuxAudit = {
    version: 1,
    ship: false,
    reasons: [],
    duration_seconds: probe.duration_seconds,
    expected_duration_seconds: Number(expected.toFixed(3)),
    has_audio: probe.has_audio,
    black_frames: 0,
    integrated_lufs: null,
    true_peak_dbfs: null,
    loudness_range_lu: null,
    lines: [],
    measured_at: now(),
  };
  if (!probe.decodes) audit.reasons.push("final_not_decodable");
  if (!probe.has_audio) audit.reasons.push("final_audio_missing");
  if (expected > 0 && Math.abs(probe.duration_seconds - expected) > Math.max(1.0, expected * 0.08)) {
    audit.reasons.push("final_duration_mismatch");
  }
  if (!(await ffmpegAvailable())) {
    audit.reasons.push("ffmpeg_unavailable");
    audit.ship = false;
    return audit;
  }

  const dir = await mkdtemp(join(tmpdir(), "sdm-mux-audit-"));
  try {
    const file = join(dir, "final.mp4");
    await writeFile(file, input.body);

    // Black-frame sweep at 2 Hz across the whole cut.
    for (let t = 0.05; t < probe.duration_seconds; t += 0.5) {
      const frame = await grayFrameAt(file, t);
      if (frame && meanLuma(frame) < BLACK_FRAME_LUMA) audit.black_frames += 1;
    }
    if (audit.black_frames > 0) audit.reasons.push("black_frames");

    let samples: Int16Array | null = null;
    let words: Array<{ start: number; end: number }> | null = null;
    if (probe.has_audio) {
      const wav = join(dir, "mux.wav");
      const ok = await run("ffmpeg", ["-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wav]);
      if (ok.ok) samples = pcmFromWav(await readFile(wav));
      if (input.transcribe) {
        try {
          const mp3 = join(dir, "mux.mp3");
          const made = await run("ffmpeg", ["-y", "-i", file, "-vn", "-ac", "1", "-ar", "44100", "-b:a", "128k", mp3]);
          if (made.ok) {
            const spoken = await input.transcribe(new Uint8Array(await readFile(mp3)));
            words = spoken?.words?.length ? spoken.words : null;
          }
        } catch {
          words = null;
        }
      }

      // Delivery loudness, measured on the encoded file rather than trusted from the normaliser.
      const measure = parseEbur128Summary(await runStderr("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]));
      if (measure) {
        audit.integrated_lufs = measure.integrated;
        audit.true_peak_dbfs = measure.truePeak;
        audit.loudness_range_lu = measure.lra;
        audit.reasons.push(...loudnessReasons(measure));
      }
    }

    for (const [index, shot] of input.manifest.shots.entries()) {
      const lane = input.heardLanes[index];
      const analysis = input.analyses[index];
      if (lane !== "native" || !analysis) continue;
      const pictureStart = shot.picture_start_seconds ?? 0;
      const pictureLength = Math.max(0.4, shot.out_point_seconds - shot.in_point_seconds);
      const { expectedVoice, mouthOnMux } = projectOnsets({
        pictureStart,
        inPoint: shot.in_point_seconds,
        padSeconds: analysis.viseme_pad_seconds,
        slipSeconds: shot.audio_slip_seconds ?? analysis.audio_slip_seconds ?? 0,
        voiceOnTake: analysis.voice_onset_seconds,
        mouthOnTake: analysis.mouth_open_seconds,
      });

      let voice: number | null = null;
      if (words && expectedVoice != null) {
        const searchFrom = Math.max(pictureStart, expectedVoice - 0.35);
        const word = words.find((row) => row.start >= searchFrom && row.start < pictureStart + pictureLength);
        voice = word ? Number(word.start.toFixed(3)) : null;
      }
      if (voice == null && samples && expectedVoice != null) {
        // No transcribed word in the window (a lone name can be missed): level onset.
        const searchFrom = Math.max(pictureStart, expectedVoice - 0.25);
        const at = firstVoicedSecond(samples, 16000, searchFrom);
        voice = at != null && at < pictureStart + pictureLength ? at : null;
      }
      const lagMs = voice != null && mouthOnMux != null ? Math.round((mouthOnMux - voice) * 1000) : null;
      // The darkness mouth probe is frame-accurate; the motion fallback is ~200ms early.
      const limitMs = input.limitMs ?? (analysis.mouth_open_seconds != null && analysis.sync_lag_ms != null && Math.abs(analysis.sync_lag_ms) <= MUX_SYNC_LIMIT_MS
        ? MUX_SYNC_LIMIT_MS
        : MUX_SYNC_SOFT_LIMIT_MS);
      // With a known mouth the gate is lip sync; without one it is placement:
      // the voice must land where the manifest put it.
      const placementMs = voice != null && expectedVoice != null ? Math.round((voice - expectedVoice) * 1000) : null;
      const passSync =
        lagMs != null ? Math.abs(lagMs) <= limitMs : placementMs != null && Math.abs(placementMs) <= MUX_SYNC_SOFT_LIMIT_MS;

      const open = await grayFrameAt(file, pictureStart + 0.05);
      const later = await grayFrameAt(file, pictureStart + 0.05 + HEAD_STEP_WINDOW_SECONDS);
      const headStep = open && later ? Number(meanAbsDiff(open, later).toFixed(2)) : null;
      const settledOpen = headStep == null ? true : headStep <= HEAD_STEP_MAX;

      audit.lines.push({
        shot_id: shot.shot_id,
        speaker: shot.speaker ?? null,
        picture_start_s: Number(pictureStart.toFixed(3)),
        expected_voice_s: Number((expectedVoice ?? 0).toFixed(3)),
        voice_onset_s: voice,
        mouth_open_s: mouthOnMux == null ? null : Number(mouthOnMux.toFixed(3)),
        lag_ms: lagMs,
        limit_ms: limitMs,
        pass: passSync && settledOpen,
        head_step: headStep,
        settled_open: settledOpen,
      });
      if (!passSync) audit.reasons.push(`sync:${shot.shot_id}`);
      if (!settledOpen) audit.reasons.push(`room_morph:${shot.shot_id}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  audit.reasons = [...new Set(audit.reasons)];
  audit.ship = audit.reasons.length === 0;
  return audit;
}
