import type { EpisodeLength } from "../../engine/config/catalog.ts";
import type { CliffhangerRule } from "./story.ts";
import { MICRO_AD_CUT, MICRO_EPISODE } from "./micro-drama.ts";

export type SilenceLicense = "post_slap" | "post_nuke" | "button_freeze" | "illegal_opera";

export type BeatWindow = {
  startMs: number;
  endMs: number;
  explosionByMs?: number;
};

export type BeatEngine = {
  durationMs: 38000 | 60000 | 120000 | 900000;
  hook: BeatWindow & { explosionByMs: 3000 };
  friction: BeatWindow;
  midReversalMax: 1;
  spike: { muteTest: true; window: BeatWindow };
  button: CliffhangerRule;
  emotionNodeEveryMs: 20000 | 25000;
};

export type LengthBudget = {
  length: EpisodeLength;
  target_episode_seconds: number;
  min_shots: number;
  max_shots: number;
  min_shot_s: number;
  max_shot_s: number;
  max_dialogue_s: number;
  duration_sum_min: number;
  duration_sum_max: number;
};

export const LENGTH_BUDGETS: Record<EpisodeLength, LengthBudget> = {
  "30_45": {
    length: "30_45",
    target_episode_seconds: MICRO_AD_CUT.target_seconds,
    min_shots: MICRO_AD_CUT.min_shots,
    max_shots: MICRO_AD_CUT.max_shots,
    min_shot_s: MICRO_AD_CUT.gen_min_s,
    max_shot_s: MICRO_AD_CUT.gen_max_s,
    max_dialogue_s: MICRO_EPISODE.gen_max_s,
    duration_sum_min: MICRO_AD_CUT.min_seconds,
    duration_sum_max: MICRO_AD_CUT.max_seconds,
  },
  "60_90": {
    length: "60_90",
    target_episode_seconds: MICRO_EPISODE.target_seconds,
    min_shots: MICRO_EPISODE.min_shots,
    max_shots: MICRO_EPISODE.max_shots,
    min_shot_s: MICRO_EPISODE.gen_min_s,
    max_shot_s: MICRO_EPISODE.gen_max_s,
    max_dialogue_s: MICRO_EPISODE.gen_max_s,
    duration_sum_min: MICRO_EPISODE.min_seconds,
    duration_sum_max: MICRO_EPISODE.max_seconds,
  },
  "120_180": {
    length: "120_180",
    target_episode_seconds: 120,
    min_shots: 14,
    max_shots: 20,
    min_shot_s: 4,
    max_shot_s: 8,
    max_dialogue_s: 10,
    duration_sum_min: 108,
    duration_sum_max: 132,
  },
  "900_1080": {
    length: "900_1080",
    target_episode_seconds: 900,
    min_shots: 120,
    max_shots: 200,
    min_shot_s: 4,
    max_shot_s: 8,
    max_dialogue_s: 10,
    duration_sum_min: 780,
    duration_sum_max: 1020,
  },
};

export const DEFAULT_CLIFFHANGER: CliffhangerRule = {
  type: "identity",
  placementMsFromEnd: { min: 2000, max: 10000, preferred: 5000 },
  visual: "freeze_face",
  audioStinger: true,
  unresolvedQuestion: "",
  muteReadable: true,
};

export function beatEngineFor(length: EpisodeLength): BeatEngine {
  const budget = LENGTH_BUDGETS[length];
  const blockMs = length === "900_1080" ? 60_000 : budget.target_episode_seconds * 1000;
  const durationMs = blockMs as BeatEngine["durationMs"];
  return {
    durationMs,
    hook: { startMs: 0, endMs: 15_000, explosionByMs: 3000 },
    friction: { startMs: 3000, endMs: Math.round(durationMs * 0.48) },
    midReversalMax: 1,
    spike: {
      muteTest: true,
      window: { startMs: Math.round(durationMs * 0.72), endMs: durationMs - 5000 },
    },
    button: { ...DEFAULT_CLIFFHANGER },
    emotionNodeEveryMs: length === "900_1080" ? 25_000 : 20_000,
  };
}

export function lengthFromSeconds(target: number): EpisodeLength {
  if (target <= 45) return "30_45";
  if (target >= 700) return "900_1080";
  if (target >= 100) return "120_180";
  return "60_90";
}
