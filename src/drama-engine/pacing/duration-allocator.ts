import type { VideoRoute } from "../../engine/domain.ts";
import { finalizeShotDuration, type DurationDecision } from "../../engine/pipeline/duration.ts";
import type { AudioRole } from "../types/editorial.ts";
import type { LengthBudget } from "../types/pacing.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";

export type AllocateInput = {
  wavSeconds: number;
  route: Pick<VideoRoute, "min_duration_seconds" | "max_duration_seconds">;
  audioRole?: AudioRole | null;
  budget?: LengthBudget;
  headHandle?: number;
  tailHandle?: number;
};

export type AllocateResult = DurationDecision & {
  craft_seconds: number;
  silence_license: "none" | "reaction_pad" | "button_freeze";
};

export function allocateShotDuration(input: AllocateInput): AllocateResult {
  const budget = input.budget ?? LENGTH_BUDGETS["60_90"];
  const base = finalizeShotDuration({
    wavSeconds: input.wavSeconds,
    route: input.route,
    headHandle: input.headHandle,
    tailHandle: input.tailHandle,
  });

  const craftMax = input.audioRole === "onscreen" ? budget.max_dialogue_s : budget.max_shot_s;
  const craftMin = budget.min_shot_s;
  let craft = Math.min(craftMax, Math.max(base.duration_seconds, craftMin));

  if (input.audioRole === "silent" && base.needs_reaction_pad) {
    craft = Math.min(3, Math.max(1.5, base.duration_seconds));
  }

  return {
    ...base,
    duration_seconds: craft,
    craft_seconds: craft,
    silence_license: base.needs_reaction_pad ? "reaction_pad" : "none",
  };
}

export function scaleHintsToBudget(hints: number[], budget: LengthBudget): number[] {
  const sum = hints.reduce((a, b) => a + b, 0);
  if (sum <= 0) return hints.map(() => (budget.min_shot_s + budget.max_shot_s) / 2);
  const target = budget.target_episode_seconds;
  const scale = target / sum;
  return hints.map((hint) => {
    const scaled = hint * scale;
    return Math.min(budget.max_shot_s, Math.max(budget.min_shot_s, Math.round(scaled * 10) / 10));
  });
}
