import type { DramaQcId, QcSeverity } from "../types/qc-drama.ts";

export type LintRule = {
  id: DramaQcId;
  severity: QcSeverity;
  threshold: string;
};

export const LINT_RULES: LintRule[] = [
  { id: "SHOT_BUDGET", severity: "block", threshold: "4–6 scene takes on 60–90s; ~duration/5 on 15 min" },
  { id: "DURATION_WINDOW", severity: "block", threshold: "sum within BeatEngine window" },
  { id: "SPEECH_WINDOW", severity: "block", threshold: "each scene take's spoken lines fit the 15s model window" },
  { id: "HOOK_3S", severity: "block", threshold: "first 3s spoken hook — dialogue already in motion" },
  { id: "NO_BUTTON", severity: "block", threshold: "last shot button_cu + cliffhanger" },
  { id: "DUPLICATE_BUTTON", severity: "block", threshold: "exactly one button_cu — the last shot" },
  { id: "ILLEGAL_SILENCE", severity: "block", threshold: "silence only as licensed 1.5–3s or ≤2s freeze" },
  { id: "INVENTED_SPEAKER", severity: "block", threshold: "speaker in named cast" },
  { id: "EDIT_VERB", severity: "block", threshold: "no Cut to / Shot N: / Hold for" },
  { id: "OPERA_PLAN", severity: "block", threshold: "60–90s is 4–6 continuous 12–15s scene takes, not chopped 4s singles" },
  { id: "ASL_HOLD", severity: "block", threshold: "≥4s silent stare without license" },
  { id: "OPERA_STARE", severity: "block", threshold: "eyeline ≠ lens" },
  { id: "MUTE_FAIL", severity: "block", threshold: "spike survives captions-only" },
  { id: "MONOLOGUE", severity: "block", threshold: "dialogue ≤12 words / ≤8s so the last word is heard" },
  { id: "TWO_FLIPS", severity: "warn", threshold: "≤1 mid-reversal" },
  { id: "CAST_BLOAT", severity: "block", threshold: "3–8 named roles including a Witness" },
  { id: "WEAK_BUTTON", severity: "block", threshold: "button line ≠ hook / first line" },
  { id: "NO_JOB", severity: "warn", threshold: "Engine/Wall/Witness/Nuke on named roles" },
  { id: "HOOK_LEDGER", severity: "block", threshold: "close ≥1 or open ≥1" },
  { id: "FACE_ON_INSERT", severity: "warn", threshold: "phone_ui / insert camera is an object, not a face" },
  { id: "EMOTION_GAP", severity: "block", threshold: "emotion node every ≤30s" },
  { id: "BLOCK_BUTTON", severity: "block", threshold: "every scene-block buttons into the next" },
  { id: "MID_REPRICE", severity: "block", threshold: "mid-episode reprice ~7–8 min" },
  { id: "REPEAT_BEAT", severity: "block", threshold: "blocks escalate; no two shots speak the same beat twice" },
  { id: "COVERAGE_MIX", severity: "block", threshold: "no establishing/wide; jump-in or object ECU instead" },
  { id: "TWO_SHOT_RISK", severity: "warn", threshold: "two-shots only from a locked group still" },
  { id: "CONTINUITY_JUMP", severity: "warn", threshold: "a location change opens on an insert or jump-in-on-conflict" },
  { id: "LIGHT_JUMP", severity: "warn", threshold: "a time-of-day change opens on an insert or jump-in-on-conflict" },
  { id: "BEAT_COUNT", severity: "block", threshold: "4–6 beats, each a change in power/knowledge/presence" },
  { id: "CHANNEL_MIX", severity: "warn", threshold: "~40% sync / 30% VO / 30% silent; sync must not pass half" },
  { id: "ONE_SENTENCE", severity: "block", threshold: "one sentence per sync shot" },
  { id: "ON_THE_NOSE", severity: "warn", threshold: "every cue ≤12 words, one sentence, no dash-fragments" },
  { id: "STAGED_TALK", severity: "warn", threshold: "casual spoken English; a refusal loop blocks" },
  { id: "CUE_COUNT", severity: "warn", threshold: "5–8 cues per scene take; under 2 blocks" },
  { id: "CAST_LOOK", severity: "warn", threshold: "named faces are specific phone-close beauty, never average or plain" },
  { id: "LOOP_REANCHOR", severity: "warn", threshold: "loop opener names both leads out loud in take 1" },
  { id: "LEADS_MEET", severity: "block", threshold: "episode 1 puts both leads on screen together" },
  { id: "CORE_EXPECTATION", severity: "warn", threshold: "one-sentence promise the season will answer" },
  { id: "NOTHING_RESOLVES", severity: "block", threshold: "nothing resolves except the season finale" },
  { id: "ADJACENT_SAME_FACE", severity: "block", threshold: "never adjacent same-character same-framing" },
  { id: "NO_RECAP_GOODBYE", severity: "block", threshold: "no recaps, goodbyes, or walking to doors" },
  { id: "BUTTON_QUESTION", severity: "warn", threshold: "button line or cliffhanger is an unpaid question or reversal" },
  { id: "DIALOGUE_SHARE", severity: "warn", threshold: "at least 45% of takes carry a spoken line" },
  { id: "COMIC_STING", severity: "block", threshold: "≥1 comic/stun cutaway + SFX" },
];
