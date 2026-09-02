export type QcSeverity = "block" | "warn";

export type DramaQcId =
  | "HOOK_3S"
  | "SETUP_10S"
  | "ASL_HOLD"
  | "OPERA_STARE"
  | "NO_BUTTON"
  | "DUPLICATE_BUTTON"
  | "WEAK_BUTTON"
  | "TWO_FLIPS"
  | "MONOLOGUE"
  | "MUTE_FAIL"
  | "TITLE_CARD_OPEN"
  | "HOOK_LEDGER"
  | "SAFE_ZONE"
  | "COSTUME_DRIFT"
  | "CAST_BLOAT"
  | "NO_JOB"
  | "SILENT_THREE"
  | "CELEB_LIKENESS"
  | "INTERNAL_CUT"
  | "TRANSCRIPT_WER"
  | "AUDIO_MISSING"
  | "SHOT_BUDGET"
  | "DURATION_WINDOW"
  | "ILLEGAL_SILENCE"
  | "INVENTED_SPEAKER"
  | "EDIT_VERB"
  | "OPERA_PLAN"
  | "FACE_ON_INSERT"
  | "EMOTION_GAP"
  | "BLOCK_BUTTON"
  | "MID_REPRICE"
  | "REPEAT_BEAT"
  | "COVERAGE_MIX"
  | "TWO_SHOT_RISK"
  | "CONTINUITY_JUMP"
  | "LIGHT_JUMP"
  | "BUTTON_QUESTION"
  | "DIALOGUE_SHARE"
  | "COMIC_STING";

export type QcReport = {
  id: DramaQcId;
  pass: boolean;
  actual: string;
  threshold: string;
  severity: QcSeverity;
  detail?: string;
};

export type DramaLintResult = {
  pass: boolean;
  blocking: QcReport[];
  warnings: QcReport[];
  reports: QcReport[];
};

export const WER_WARN = 0.15;
export const WER_BLOCK = 0.25;

export function qc(
  id: DramaQcId,
  pass: boolean,
  actual: string,
  threshold: string,
  severity: QcSeverity,
  detail?: string,
): QcReport {
  return { id, pass, actual, threshold, severity, detail };
}
