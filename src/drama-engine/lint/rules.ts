import type { DramaQcId, QcSeverity } from "../types/qc-drama.ts";

export type LintRule = {
  id: DramaQcId;
  severity: QcSeverity;
  threshold: string;
};

export const LINT_RULES: LintRule[] = [
  { id: "SHOT_BUDGET", severity: "block", threshold: "8–12 takes on 60s; ~duration/5 on 15 min" },
  { id: "DURATION_WINDOW", severity: "block", threshold: "sum within BeatEngine window" },
  { id: "HOOK_3S", severity: "block", threshold: "first shot in motion (hook_cu / insert / slap)" },
  { id: "NO_BUTTON", severity: "block", threshold: "last shot button_cu + cliffhanger" },
  { id: "DUPLICATE_BUTTON", severity: "block", threshold: "exactly one button_cu — the last shot" },
  { id: "ILLEGAL_SILENCE", severity: "block", threshold: "silence only as licensed 1.5–3s or ≤2s freeze" },
  { id: "INVENTED_SPEAKER", severity: "block", threshold: "speaker in named cast" },
  { id: "EDIT_VERB", severity: "block", threshold: "no Cut to / Shot N: / Hold for" },
  { id: "OPERA_PLAN", severity: "block", threshold: "60s: reject 16-shot or ≥12s talking-head plans" },
  { id: "ASL_HOLD", severity: "block", threshold: "≥4s silent stare without license" },
  { id: "OPERA_STARE", severity: "block", threshold: "eyeline ≠ lens" },
  { id: "MUTE_FAIL", severity: "block", threshold: "spike survives captions-only" },
  { id: "MONOLOGUE", severity: "warn", threshold: "dialogue ≤10s / ≤12 words" },
  { id: "TWO_FLIPS", severity: "warn", threshold: "≤1 mid-reversal" },
  { id: "CAST_BLOAT", severity: "block", threshold: "3–8 named roles including a Witness" },
  { id: "WEAK_BUTTON", severity: "block", threshold: "button line ≠ hook / first line" },
  { id: "NO_JOB", severity: "warn", threshold: "Engine/Wall/Witness/Nuke on named roles" },
  { id: "HOOK_LEDGER", severity: "block", threshold: "close ≥1 or open ≥1" },
  { id: "FACE_ON_INSERT", severity: "warn", threshold: "phone_ui / insert camera is an object, not a face" },
  { id: "EMOTION_GAP", severity: "block", threshold: "emotion node every ≤30s" },
  { id: "BLOCK_BUTTON", severity: "block", threshold: "every scene-block buttons into the next" },
  { id: "MID_REPRICE", severity: "block", threshold: "mid-episode reprice ~7–8 min" },
  { id: "REPEAT_BEAT", severity: "block", threshold: "blocks must escalate, not copy the same argument" },
];
