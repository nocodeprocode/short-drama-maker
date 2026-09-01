import { foldSpoken, wordErrorRate } from "../media/qc.ts";
import type { Shot } from "../domain.ts";
import { WER_BLOCK, WER_WARN } from "../../drama-engine/types/qc-drama.ts";

export const DIALOGUE_STT_SAMPLE_EVERY = 1;

export function shouldSampleDialogueStt(shot: Shot, _episodeShots: readonly Shot[]): boolean {
  if (!shot.shot_data.dialogue) return false;
  if (shot.shot_data.audio_role === "offscreen") return false;
  return true;
}

export function dialogueMatchesTranscript(expected: string, transcript: string): boolean {
  if (foldSpoken(transcript) === foldSpoken(expected)) return true;
  return wordErrorRate(expected, transcript) <= WER_WARN;
}

export function dialogueWerReasons(expected: string, transcript: string): string[] {
  const wer = wordErrorRate(expected, transcript);
  if (wer > WER_BLOCK) return ["transcript_wer"];
  if (wer > WER_WARN) return ["transcript_wer_warn"];
  return [];
}
