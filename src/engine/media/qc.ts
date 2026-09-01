import { QC_AUTOPILOT_DURATION_TOLERANCE_SECONDS, QC_DURATION_TOLERANCE_SECONDS } from "../config/models.ts";
import type { AlignmentTrack } from "../domain.ts";

export type ProbeResult = {
  exists: boolean;
  decodes: boolean;
  duration_seconds: number;
  width: number;
  height: number;
  has_audio: boolean;
  black_frames: boolean;
};

export type QcVerdict = {
  pass: boolean;
  reasons: string[];
};

export function mechanicalQc(input: {
  probe: ProbeResult;
  expectedDuration: number;
  requireAudio: boolean;
  expectedDialogue: string | null;
  outputTranscript: string | null;
  durationToleranceSeconds?: number;
}): QcVerdict {
  const reasons: string[] = [];
  const durationTolerance = input.durationToleranceSeconds ?? QC_DURATION_TOLERANCE_SECONDS;

  if (!input.probe.exists) reasons.push("file_missing");
  if (!input.probe.decodes) reasons.push("decode_failed");
  if (input.probe.black_frames) reasons.push("black_frames");

  const aspect = input.probe.width > 0 ? input.probe.height / input.probe.width : 0;
  if (Math.abs(aspect - 16 / 9) > 0.05 && Math.abs(aspect - 9 / 16) > 0.05) {
    reasons.push("aspect_not_9_16");
  }
  if (input.probe.width > 0 && input.probe.width >= input.probe.height) {
    reasons.push("not_portrait");
  }

  const drift = Math.abs(input.probe.duration_seconds - input.expectedDuration);
  if (drift > 3) {
    reasons.push("duration_disaster");
  } else if (drift > durationTolerance) {
    reasons.push("duration_mismatch");
  }

  if (input.requireAudio && !input.probe.has_audio) {
    reasons.push("audio_missing");
  }

  if (input.expectedDialogue && input.outputTranscript !== null) {
    const wer = wordErrorRate(input.expectedDialogue, input.outputTranscript);
    if (wer > 0.25) reasons.push("transcript_mismatch", "transcript_wer");
    else if (wer > 0.15) reasons.push("transcript_wer_warn");
  }

  return { pass: reasons.length === 0, reasons };
}

export function blockingQcReasons(reasons: string[]): string[] {
  return reasons.filter(
    (reason) =>
      reason !== "stt_sample_failed" &&
      reason !== "duration_mismatch" &&
      reason !== "transcript_wer_warn" &&
      reason !== "first_frame_not_cu" &&
      reason !== "insert_used_face_still" &&
      reason !== "internal_cut",
  );
}

export function transcriptFromAlignment(track: AlignmentTrack): string {
  if (track.characters.length > 0) {
    return track.characters.map((item) => item.char).join("");
  }
  return track.text;
}

export function normalizeDialogue(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

const SPOKEN_FOLDS: Record<string, string> = {
  gonna: "going",
  wanna: "want",
  gotta: "got",
};

export function foldSpoken(text: string): string {
  let out = normalizeDialogue(text);
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  for (const [from, to] of Object.entries(SPOKEN_FOLDS)) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return out;
}

export function tokenizeSpoken(text: string): string[] {
  return foldSpoken(text).split(" ").filter(Boolean);
}

export function wordErrorRate(expected: string, actual: string): number {
  const ref = tokenizeSpoken(expected);
  const hyp = tokenizeSpoken(actual);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dp[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[ref.length]![hyp.length]! / ref.length;
}
