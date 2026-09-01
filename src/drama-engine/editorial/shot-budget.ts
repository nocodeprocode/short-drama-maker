import type { EpisodePlan, ShotPlanScene } from "../../engine/domain.ts";
import type { LengthBudget } from "../types/pacing.ts";
import { DIALOGUE_MAX_WORDS, wordCount } from "../types/dialogue.ts";
import type { AudioRole, EditMode, ShotFunction } from "../types/editorial.ts";

type PlanShot = ShotPlanScene["shots"][number];

function cloneShot(shot: PlanShot, patch: Partial<PlanShot>): PlanShot {
  return { ...shot, ...patch };
}

function splitLine(text: string): [string, string] {
  const words = text.trim().split(/\s+/);
  if (words.length <= DIALOGUE_MAX_WORDS) {
    const mid = Math.max(1, Math.ceil(words.length / 2));
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  return [
    words.slice(0, DIALOGUE_MAX_WORDS).join(" "),
    words.slice(DIALOGUE_MAX_WORDS).join(" "),
  ];
}

export function mergeTinyShots(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const out: PlanShot[] = [];
  for (const shot of shots) {
    const prev = out[out.length - 1];
    const tiny = shot.duration_hint_seconds < budget.min_shot_s && !shot.dialogue;
    if (tiny && prev && prev.type === shot.type && !prev.dialogue && !shot.dialogue) {
      prev.duration_hint_seconds = Math.min(
        budget.max_shot_s,
        prev.duration_hint_seconds + shot.duration_hint_seconds,
      );
      continue;
    }
    out.push({ ...shot });
  }
  return out;
}

export function splitLongShots(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const out: PlanShot[] = [];
  for (const shot of shots) {
    const tooLong =
      shot.duration_hint_seconds > budget.max_dialogue_s ||
      (shot.dialogue != null && wordCount(shot.dialogue) > DIALOGUE_MAX_WORDS);
    if (!tooLong || !shot.dialogue) {
      const licensed =
        shot.silence_license === "post_slap" ||
        shot.silence_license === "post_nuke" ||
        shot.silence_license === "button_freeze";
      out.push({
        ...shot,
        duration_hint_seconds: licensed
          ? shot.duration_hint_seconds
          : clampDuration(shot.duration_hint_seconds, budget, Boolean(shot.dialogue)),
      });
      continue;
    }
    const [first, second] = splitLine(shot.dialogue);
    const half = Math.max(budget.min_shot_s, Math.min(budget.max_shot_s, shot.duration_hint_seconds / 2));
    const leftover = second && wordCount(second) <= 2 ? `${first} ${second}`.trim() : first;
    out.push(
      cloneShot(shot, {
        dialogue: leftover,
        duration_hint_seconds: half,
        mouth_visibility_required: true,
        audio_role: (shot.audio_role ?? "onscreen") as AudioRole,
      }),
    );
    if (second && wordCount(second) > 2) {
      out.push(
        cloneShot(shot, {
          dialogue: second,
          duration_hint_seconds: half,
          hero: false,
        }),
      );
    }
  }
  return out;
}

export function clampDuration(seconds: number, budget: LengthBudget, dialogue: boolean): number {
  const max = dialogue ? budget.max_dialogue_s : budget.max_shot_s;
  return Math.min(max, Math.max(budget.min_shot_s, seconds));
}

export function applyShotBudget(plan: EpisodePlan, budget: LengthBudget): EpisodePlan {
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      shots: mergeTinyShots(splitLongShots(scene.shots, budget), budget),
    })),
  };
}

export function collapseToShotBudget(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const out = shots.map((shot) => ({ ...shot }));
  let guard = 0;
  while (out.length > budget.max_shots && guard++ < 48) {
    let changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!;
      const b = out[i + 1]!;
      if (a.dialogue || b.dialogue) continue;
      const keepFirst = i === 0;
      const keepLast = i + 1 === out.length - 1;
      const keep = keepLast ? b : a;
      const other = keep === a ? b : a;
      keep.duration_hint_seconds = clampDuration(
        Math.max(keep.duration_hint_seconds, other.duration_hint_seconds),
        budget,
        false,
      );
      if (keepFirst) keep.function = keep.function ?? "hook_cu";
      if (keepLast) keep.function = "button_cu";
      out.splice(i, 2, keep);
      changed = true;
      break;
    }
    if (changed) continue;
    for (let i = 1; i < out.length - 2; i++) {
      const a = out[i]!;
      const b = out[i + 1]!;
      if (!a.dialogue || !b.dialogue || a.speaker !== b.speaker) continue;
      const text = `${a.dialogue} ${b.dialogue}`.trim();
      if (wordCount(text) > DIALOGUE_MAX_WORDS) continue;
      a.dialogue = text;
      a.duration_hint_seconds = clampDuration(
        a.duration_hint_seconds + b.duration_hint_seconds / 2,
        budget,
        true,
      );
      out.splice(i + 1, 1);
      changed = true;
      break;
    }
    if (changed) continue;
    const dropAt = out.findIndex(
      (shot, index) =>
        index > 0 &&
        index < out.length - 1 &&
        !shot.dialogue &&
        shot.function !== "insert_evidence" &&
        shot.function !== "hook_cu" &&
        shot.function !== "button_cu" &&
        shot.function !== "establishing" &&
        shot.function !== "stacked_two",
    );
    if (dropAt >= 0) {
      out.splice(dropAt, 1);
      continue;
    }
    if (out.length > 2) {
      out.splice(Math.floor(out.length / 2), 1);
      continue;
    }
    break;
  }
  return out;
}

export function defaultCraftForShot(
  shot: PlanShot,
  index: number,
  total: number,
): {
  edit_mode: EditMode;
  audio_role: AudioRole;
  function: ShotFunction;
  eyeline: NonNullable<PlanShot["eyeline"]>;
} {
  const audio_role: AudioRole =
    shot.audio_role ??
    (shot.type === "reaction" || shot.type === "broll" || shot.type === "establishing"
      ? shot.dialogue
        ? "offscreen"
        : "silent"
      : "onscreen");
  let fn: ShotFunction = shot.function ?? "accusation_cu";
  if (index === 0) fn = shot.function && shot.function !== "accusation_cu" ? shot.function : "hook_cu";
  if (index === total - 1) fn = "button_cu";
  else if (shot.function === "block_button") fn = "block_button";
  if (shot.type === "reaction" && index !== 0 && index !== total - 1) fn = shot.function ?? "reaction";
  if (shot.type === "establishing") fn = shot.function ?? "establishing";
  if (shot.type === "broll") fn = shot.function ?? "insert_evidence";
  return {
    edit_mode: shot.edit_mode ?? "locked_take",
    audio_role,
    function: fn,
    eyeline: shot.eyeline ?? "lens_forbidden",
  };
}
