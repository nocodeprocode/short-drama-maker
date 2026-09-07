import type { EpisodePlan, ShotPlanScene } from "../../engine/domain.ts";
import { cameraDescribesFace, objectPlateCamera, speakersForSceneTake } from "../craft/prompt-fragments.ts";
import { groupEditorialScenes } from "../editorial/scene-groups.ts";
import { cameraIsObjectPlate, isObjectInsert, isSceneTake, isWideCoverage } from "../types/editorial.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import {
  applyShotBudget,
  clampDuration,
  collapseToShotBudget,
  defaultCraftForShot,
} from "../editorial/shot-budget.ts";
import { consumeReactionPad, silenceLegal } from "../pacing/reaction-pad.ts";
import { clipCueToBreath, DIALOGUE_MAX_WORDS, dialogueTooClose, sceneTakesAreCopies, wordCount } from "../types/dialogue.ts";
import { channelOf, coreExpectationFrom, isOneSentence } from "../types/micro-drama.ts";
import {
  assignSceneSides,
  coverageCamera,
  coverageForTake,
  cueRows,
  cueText,
  fitCueRows,
  inferPropLock,
  presenceLedger,
  splitCueSentences,
  spokenSeconds,
  upperFrameFor,
  type SceneBlocking,
} from "../types/continuity.ts";
import { LENGTH_BUDGETS, type LengthBudget } from "../types/pacing.ts";
import { isLongFormLength } from "../../engine/config/catalog.ts";
import { recapBudgetSeconds } from "../plans/index.ts";
import { asksAQuestion, lineInMotion, type ValidatePlanInput } from "./validate-plan.ts";

const BLOCK_CRAFT: LengthBudget = {
  length: "60_90",
  target_episode_seconds: 64,
  min_shots: 8,
  max_shots: 14,
  min_shot_s: 4,
  max_shot_s: 8,
  max_dialogue_s: 10,
  duration_sum_min: 56,
  duration_sum_max: 75,
};

type PlanShot = ShotPlanScene["shots"][number];

function uniqueNames(plan: EpisodePlan, shots: PlanShot[]): string[] {
  const spoken = shots.flatMap((shot) => [shot.speaker, shot.speaker_on_camera]).filter((name): name is string => Boolean(name));
  const roster = plan.scenes.flatMap((scene) => scene.characters ?? []);
  return [...new Set([...roster, ...spoken])];
}

/**
 * Stage direction is not dialogue. Outline text like "Callum says: 'It doesn't
 * mean what you think.' His phone buzzes on the counter." must never be put in
 * an actor's mouth; either the quoted speech is lifted out or a real button
 * line replaces it.
 */
export function isNarrationLine(text: string | null | undefined): boolean {
  if (!text) return true;
  return (
    /\b(mouth opens|camera holds|we see|the camera|opens — and closes)\b/i.test(text) ||
    /\b\w+ (says|said|whispers|whispered|shouts|shouted|asks|asked|replies|replied|mutters|snaps)\b\s*[:,]?\s*['"“‘]/i.test(text) ||
    /\b(his|her|their) (phone|glass|hand|hands|voice|eyes|face|door|jaw)\b/i.test(text) ||
    /\b(buzzes|rings|slams|shatters|enters|exits|walks (in|out|away)|turns away|looks up|cuts? to|hold on|we hear)\b/i.test(text)
  );
}

/** The spoken part of a stage direction, if it quotes one. */
export function quotedSpeech(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /['"“‘]([^'"”’]{3,})['"”’]/.exec(text);
  const line = match?.[1]?.trim();
  return line && !isNarrationLine(line) ? line : null;
}

/**
 * Story-derived fallbacks. Nothing here names an object or a plot: the button
 * comes from the plan's own cliffhanger or core expectation, the hook from the
 * plan's hook, and the insert object from the locked prop or the genre motif.
 */
/**
 * A long core expectation cut down to something a person could say: keep the
 * interrogative head and the last clause, drop the setup.
 */
function shortQuestion(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim().replace(/[.!?]+$/, "");
  if (!raw) return null;
  if (wordCount(raw) <= DIALOGUE_MAX_WORDS) return `${raw}?`;
  // A clause is only speech if it opens like one. "by morning her mother's
  // forty thousand is gone?" is a sentence fragment, not a line.
  const clause = raw.split(/,|—|;/).map((part) => part.trim()).filter(Boolean).at(-1);
  const speakable = clause && /^(who|what|why|how|when|where|do|does|did|are|is|will|can|you|your|tell|say)\b/i.test(clause);
  if (clause && speakable && wordCount(clause) <= DIALOGUE_MAX_WORDS) return `${clause}?`;
  return null;
}

function fallbackButtons(plan: EpisodePlan): string[] {
  const core = shortQuestion(plan.cliffhanger || plan.hook) ?? shortQuestion(coreExpectationFrom(plan.cliffhanger || plan.hook));
  // Never template a name into a line. "COLE, who are you to MARA?" is a slot
  // filler, not speech: a person in the room says "you", not the other name.
  return [core, "Who are you really?", "What are you not telling me?", "Say that again, slowly."].filter(
    (line): line is string => Boolean(line) && wordCount(line!) <= DIALOGUE_MAX_WORDS,
  );
}

/** The opener when a plan has no live first line: its own hook, cut to a breath. */
export function hookLine(plan: EpisodePlan, speaker?: string | null): string {
  const raw = plan.hook?.trim() || plan.cliffhanger?.trim() || "";
  const words = raw.replace(/[.!]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length && !isNarrationLine(raw)) return words.slice(0, DIALOGUE_MAX_WORDS).join(" ");
  const name = (speaker ?? "").split(/\s+/)[0];
  return name ? `${name}, look at me.` : "Look at me.";
}

/** The mute-readable object for inserts and recaps: the locked prop, else the genre's first motif. */
export function insertObject(plan: EpisodePlan, genreMotifs?: readonly string[] | null): string {
  const prop = plan.scenes.flatMap((scene) => scene.shots).map((shot) => shot.blocking?.prop?.trim()).find(Boolean);
  if (prop) return prop.replace(/^the same\s+/i, "the ");
  return genreMotifs?.[0] ? `the ${genreMotifs[0]}` : "the locked object";
}

function cliffLine(plan: EpisodePlan): string {
  const shots = plan.scenes.flatMap((scene) => scene.shots);
  const firstSpoken = shots.find((shot) => isSpokenLine(shot))?.dialogue;
  const banned = [shots[0]?.dialogue, firstSpoken, plan.hook];
  const spoken = shots
    .slice(1)
    .map((shot) => shot.dialogue)
    .find(
      (line) =>
        line &&
        /[?]/.test(line) &&
        !isNarrationLine(line) &&
        wordCount(line) <= DIALOGUE_MAX_WORDS &&
        !banned.some((hook) => dialogueTooClose(line, hook)),
    );
  if (spoken) return spoken;
  const raw = plan.cliffhanger?.trim() || "";
  if (raw && !isNarrationLine(raw) && !banned.some((hook) => dialogueTooClose(raw, hook))) {
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length <= DIALOGUE_MAX_WORDS) return raw.replace(/[.!]+$/, "?");
  }
  const fallbacks = fallbackButtons(plan);
  return fallbacks.find((line) => !banned.some((hook) => dialogueTooClose(line, hook))) ?? fallbacks[0] ?? coreExpectationFrom(plan.hook);
}

function craftShot(shot: PlanShot, index: number, total: number): PlanShot {
  const craft = defaultCraftForShot(shot, index, total);
  const edge = index === 0 || index === total - 1;
  const silentIllegal =
    !edge &&
    !shot.dialogue &&
    shot.duration_hint_seconds >= 4 &&
    craft.function !== "insert_evidence" &&
    craft.function !== "phone_ui" &&
    craft.function !== "hook_cu" &&
    craft.function !== "button_cu" &&
    craft.function !== "establishing" &&
    craft.function !== "stacked_two" &&
    shot.type !== "broll" &&
    shot.type !== "establishing";
  return {
    ...shot,
    ...craft,
    camera: isObjectInsert({ ...shot, function: craft.function })
      ? objectPlateCamera(craft.function, shot.camera)
      : sanitizeCamera(shot.camera, {
          lockedTake: craft.edit_mode === "locked_take",
          single: !isSceneTake({ ...shot, ...craft }),
        }),
    mouth_visibility_required: craft.audio_role === "onscreen" && Boolean(shot.dialogue),
    speaker_on_camera:
      shot.speaker_on_camera ?? (craft.audio_role === "offscreen" ? null : shot.speaker) ?? null,
    speakers_off_camera:
      shot.speakers_off_camera ??
      (craft.audio_role === "offscreen" && shot.speaker ? [shot.speaker] : []),
    ...(silentIllegal
      ? {
          type: "reaction" as const,
          function: "reaction" as const,
          audio_role: "silent" as const,
          duration_hint_seconds: 2.5,
          silence_license: "post_nuke" as const,
          mouth_visibility_required: false,
        }
      : {}),
  };
}

function applyPads(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const padded: PlanShot[] = [];
  for (const [index, shot] of shots.entries()) {
    const next = shots[index + 1];
    const { shot: kept, inserted } = consumeReactionPad({
      needs_reaction_pad: Boolean(shot.dialogue && shot.duration_hint_seconds < budget.min_shot_s),
      shot: { ...shot, speaker_on_camera: shot.speaker_on_camera ?? null },
      next: next ? { ...next, speaker_on_camera: next.speaker_on_camera ?? null } : undefined,
    });
    padded.push({ ...shot, ...kept, speaker_on_camera: kept.speaker_on_camera ?? null });
    if (inserted && padded.length < budget.max_shots) {
      padded.push({
        ...shot,
        ...inserted,
        speaker_on_camera: inserted.speaker_on_camera ?? null,
        speakers_off_camera: inserted.speakers_off_camera ?? [],
        edit_mode: inserted.edit_mode ?? "locked_take",
        audio_role: inserted.audio_role ?? "silent",
        function: inserted.function ?? "reaction",
        eyeline: inserted.eyeline ?? "lens_forbidden",
      });
    }
  }
  return padded;
}

function isSpokenLine(shot: PlanShot): boolean {
  return Boolean(shot.dialogue) && shot.audio_role !== "silent";
}

/** Last shot is the only button. Earlier button_cu become accusation or listener. */
export function collapseDuplicateButtons(shots: PlanShot[]): PlanShot[] {
  if (shots.length < 2) return shots;
  const last = shots.length - 1;
  return shots.map((shot, index) => {
    if (index === last) {
      return { ...shot, function: "button_cu" };
    }
    if (shot.function === "block_button") return shot;
    if (shot.function !== "button_cu") return shot;
    if (shot.dialogue) {
      return {
        ...shot,
        function: "accusation_cu",
        type: "dialogue",
        audio_role: shot.audio_role === "offscreen" ? "offscreen" : "onscreen",
      };
    }
    return {
      ...shot,
      function: "listener_hold",
      type: "reaction",
      audio_role: shot.audio_role ?? "silent",
    };
  });
}

function growSpokenForSku(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  // Handbook 60_90 wants 1.5–3s used picture; do not inflate every line to 5–6s.
  const floor = budget.length === "60_90" || budget.length === "30_45" ? 4 : 6;
  return shots.map((shot) => {
    if (shot.silence_license === "post_nuke" || shot.silence_license === "post_slap") return shot;
    if (!isSpokenLine(shot) && shot.function !== "button_cu") return shot;
    return {
      ...shot,
      duration_hint_seconds: clampDuration(Math.max(floor, shot.duration_hint_seconds), budget, true),
    };
  });
}

function shrinkToWindow(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const all = shots.map((shot) => ({ ...shot }));
  let sum = all.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  if (sum <= budget.duration_sum_max) return all;
  let excess = sum - budget.duration_sum_max;
  const floorFor = (shot: PlanShot) => {
    if (isSpokenLine(shot)) return Math.max(budget.min_shot_s, Math.min(shot.duration_hint_seconds, 2 + wordCount(shot.dialogue) * 0.3));
    return shot.function === "insert_evidence" || shot.function === "phone_ui" ? 2 : budget.min_shot_s;
  };
  for (let pass = 0; pass < 12 && excess > 0.05; pass += 1) {
    const room = all
      .filter((shot) => !shot.recap && shot.duration_hint_seconds > floorFor(shot) + 0.05)
      .sort((a, b) => b.duration_hint_seconds - a.duration_hint_seconds);
    if (!room.length) break;
    for (const shot of room) {
      if (excess <= 0) break;
      const cut = Math.min(0.5, shot.duration_hint_seconds - floorFor(shot), excess);
      shot.duration_hint_seconds = Number((shot.duration_hint_seconds - cut).toFixed(2));
      excess -= cut;
    }
  }
  return all;
}

function growToWindow(shots: PlanShot[], budget: LengthBudget): PlanShot[] {
  const all = growSpokenForSku(shots, budget).map((shot) => ({ ...shot }));
  let sum = all.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  if (sum < budget.duration_sum_min) {
    const deficit = budget.duration_sum_min - sum + 0.5;
    const growable = all.filter(
      (shot) =>
        shot.duration_hint_seconds < (isSpokenLine(shot) ? budget.max_dialogue_s : budget.max_shot_s) &&
        shot.silence_license !== "post_nuke" &&
        shot.silence_license !== "post_slap",
    );
    // Silent shots have a legal ceiling of their own: an insert or wide can read
    // for six seconds, a silent face for three. Growing them to the shot cap
    // manufactures the stares the lint forbids.
    const capFor = (shot: PlanShot) => {
      if (isSpokenLine(shot)) return budget.max_dialogue_s;
      const readable = shot.function === "insert_evidence" || shot.function === "phone_ui" || shot.function === "establishing" || shot.function === "stacked_two" || shot.type === "broll" || shot.type === "establishing";
      return Math.min(budget.max_shot_s, readable ? 6 : 3);
    };
    let remaining = deficit;
    for (let pass = 0; pass < 4 && remaining > 0.05; pass += 1) {
      const room = growable.filter((shot) => shot.duration_hint_seconds < capFor(shot));
      if (!room.length) break;
      const bump = remaining / room.length;
      for (const shot of room) {
        const before = shot.duration_hint_seconds;
        shot.duration_hint_seconds = Math.min(capFor(shot), before + bump);
        remaining -= shot.duration_hint_seconds - before;
      }
    }
    sum = all.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  }
  if (sum < budget.duration_sum_min && all.length < budget.max_shots) {
    const insertAt = Math.max(0, all.length - 1);
    all.splice(insertAt, 0, {
      type: "broll",
      speaker: null,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: "insert of the evidence that flips the room",
      mouth_visibility_required: false,
      duration_hint_seconds: Math.min(budget.max_shot_s, Math.max(4, budget.duration_sum_min - sum + 0.5)),
      function: "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
    });
  }
  return all;
}

function sealBeats(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  if (!shots.length) return shots;
  // A flat opening line ("Good morning, how was the flight") is not a hook.
  // Pull the first line that is already in motion to the front; if none is,
  // sharpen the opener into a question so the explosion lands by 3s.
  if (shots[0]!.dialogue && !lineInMotion(shots[0]!.dialogue)) {
    const motionAt = shots.findIndex((shot, index) => index > 0 && index < shots.length - 1 && shot.dialogue && lineInMotion(shot.dialogue) && !shot.recap);
    if (motionAt > 0) {
      const [moved] = shots.splice(motionAt, 1);
      shots.unshift(moved!);
    } else {
      const opener = shots[0]!;
      const line = opener.dialogue!.replace(/[.!\s]+$/, "");
      opener.dialogue = `${line.split(/\s+/).slice(0, 6).join(" ")}?`;
    }
  }
  const first = shots[0]!;
  if (!first.dialogue) {
    const spokenAt = shots.findIndex(
      (shot, index) => index > 0 && index < shots.length - 1 && shot.dialogue && lineInMotion(shot.dialogue) && !shot.recap,
    );
    if (spokenAt > 0) {
      const [moved] = shots.splice(spokenAt, 1);
      shots.unshift(moved!);
    } else {
      first.dialogue = "You knew?";
      first.speaker = first.speaker ?? first.speaker_on_camera ?? shots.find((shot) => shot.speaker)?.speaker ?? "Lead";
      first.speaker_on_camera = first.speaker;
      first.type = "dialogue";
      first.function = "hook_cu";
      first.audio_role = "onscreen";
      first.mouth_visibility_required = true;
      first.camera = `Tight single on ${first.speaker}'s face, eyes off lens`;
    }
  }
  const opener = shots[0]!;
  opener.function = "hook_cu";
  opener.type = opener.type === "hero" ? "hero" : "dialogue";
  opener.eyeline = opener.eyeline ?? "lens_forbidden";
  opener.edit_mode = opener.edit_mode ?? "locked_take";

  const last = shots[shots.length - 1]!;
  last.function = "button_cu";
  last.eyeline = last.eyeline ?? "lens_forbidden";
  last.edit_mode = last.edit_mode ?? "locked_take";
  if (!last.dialogue || isNarrationLine(last.dialogue)) {
    last.dialogue = cliffLine(plan);
    last.speaker = last.speaker ?? last.speaker_on_camera ?? shots.find((shot) => shot.speaker)?.speaker ?? "Lead";
    last.speaker_on_camera = last.speaker;
    last.type = "hero";
    last.audio_role = "onscreen";
    last.mouth_visibility_required = true;
    last.silence_license = null;
    last.duration_hint_seconds = clampDuration(Math.max(5, last.duration_hint_seconds), budget, true);
    // A button that was a silent insert now speaks: it needs a face, not the paper.
    if (cameraIsObjectPlate(last.camera) || !cameraDescribesFace(last.camera)) {
      last.camera = `Tight single on ${last.speaker}'s face, eyes to the off-screen partner, one held breath before the line`;
    }
  } else if (wordCount(last.dialogue) > DIALOGUE_MAX_WORDS) {
    last.dialogue = last.dialogue.split(/\s+/).slice(0, DIALOGUE_MAX_WORDS).join(" ");
  }
  if (
    wordCount(last.dialogue) < 3 ||
    dialogueTooClose(last.dialogue, opener.dialogue) ||
    dialogueTooClose(last.dialogue, plan.hook)
  ) {
    last.dialogue = cliffLine(plan);
    last.mouth_visibility_required = true;
    last.audio_role = "onscreen";
  }
  if (dialogueTooClose(last.dialogue, opener.dialogue) || dialogueTooClose(last.dialogue, plan.hook)) {
    const fallbacks = fallbackButtons(plan);
    last.dialogue = fallbacks.find((line) => !dialogueTooClose(line, opener.dialogue) && !dialogueTooClose(line, plan.hook)) ?? fallbacks[0] ?? last.dialogue;
  }

  for (const [index, shot] of shots.entries()) {
    if (index === 0 || index === shots.length - 1) continue;
    if (shot.function !== "hook_cu") continue;
    if (!shot.dialogue) {
      shot.function = "reaction";
      shot.type = "reaction";
      shot.audio_role = "silent";
      shot.silence_license = "post_nuke";
      shot.duration_hint_seconds = 2.5;
      shot.mouth_visibility_required = false;
    } else {
      shot.function = "accusation_cu";
    }
  }

  const hasSpike = shots.some((shot, index) => {
    if (index === 0 || index === shots.length - 1) {
      return shot.function === "insert_evidence" || shot.function === "slap_peak";
    }
    return (
      shot.function === "insert_evidence" ||
      shot.function === "slap_peak" ||
      shot.type === "broll" ||
      shot.type === "hero" ||
      /\b(slap|paper|receipt|test|mark|door|phone|ring|badge|clause)\b/i.test(
        `${shot.dialogue ?? ""} ${shot.camera}`,
      )
    );
  });
  if (!hasSpike && shots.length > 2) {
    const mid = shots[Math.max(1, shots.length - 3)]!;
    mid.type = "broll";
    mid.function = "insert_evidence";
    mid.audio_role = mid.dialogue ? "offscreen" : "silent";
    mid.mouth_visibility_required = false;
    if (!mid.dialogue) mid.duration_hint_seconds = clampDuration(Math.max(4, mid.duration_hint_seconds), budget, false);
  }

  const hasReaction = shots.some(
    (shot, index) =>
      index > 0 &&
      index < shots.length - 1 &&
      (shot.type === "reaction" || shot.function === "reaction" || shot.function === "listener_hold"),
  );
  if (!hasReaction && shots.length > 3) {
    const afterDialogue = shots.findIndex(
      (shot, index) => index > 0 && index < shots.length - 1 && Boolean(shots[index - 1]?.dialogue),
    );
    const target = shots[afterDialogue > 0 ? afterDialogue : 1];
    if (target && !target.dialogue && target.function !== "insert_evidence") {
      target.type = "reaction";
      target.function = "reaction";
      target.audio_role = "silent";
      target.silence_license = "post_nuke";
      target.duration_hint_seconds = 2.5;
      target.mouth_visibility_required = false;
    }
  }

  return shots;
}

function otherName(plan: EpisodePlan, shots: PlanShot[], pictured: string | null): string {
  const names = uniqueNames(plan, shots);
  return names.find((name) => name.split(/\s+/)[0]?.toLowerCase() !== pictured?.toLowerCase()) ?? names[0] ?? "Lead";
}

function picturedOf(shot: PlanShot): string | null {
  if (shot.function === "insert_evidence" || shot.function === "phone_ui" || shot.type === "broll") return null;
  if (shot.speaker_on_camera) return shot.speaker_on_camera.split(/\s+/)[0] ?? null;
  if (shot.audio_role === "offscreen" || shot.function === "listener_hold") return null;
  return shot.speaker?.split(/\s+/)[0] ?? null;
}

function framingOf(shot: PlanShot): string {
  if (shot.function === "reaction" || shot.function === "listener_hold") return "reaction";
  if (shot.function === "insert_evidence" || shot.function === "phone_ui") return "insert";
  if (shot.function === "slap_peak" || shot.function === "doorway_reveal") return "mcu";
  return "cu";
}

function reactionHold(name: string, duration: number): PlanShot {
  return {
    type: "reaction",
    speaker: name,
    speaker_on_camera: name,
    dialogue: null,
    emotion: "struck",
    delivery: null,
    pace: null,
    camera: `Medium close-up of ${name}'s face, head and shoulders, silent reaction`,
    mouth_visibility_required: false,
    duration_hint_seconds: duration,
    function: "reaction",
    audio_role: "silent",
    edit_mode: "locked_take",
    eyeline: "lens_forbidden",
    silence_license: "post_nuke",
  };
}

function injectPingPong(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  const out: PlanShot[] = [];
  for (const [index, shot] of shots.entries()) {
    if (shot.function === "establishing" || shot.type === "establishing" || shot.function === "stacked_two") {
      if (shot.dialogue) {
        shot.function = "accusation_cu";
        shot.type = "dialogue";
        shot.camera = `Tight single on ${(shot.speaker_on_camera ?? shot.speaker) ?? "the speaker"}'s face, eyes off lens`;
      } else {
        shot.function = "insert_evidence";
        shot.type = "broll";
        shot.speaker = null;
        shot.speaker_on_camera = null;
        shot.camera = "insert of unlabeled paper on dark stone, object only, no people, no readable text";
        shot.audio_role = "silent";
        shot.mouth_visibility_required = false;
      }
    }
    const prev = out[out.length - 1];
    const clash =
      Boolean(prev && picturedOf(prev) && picturedOf(shot) === picturedOf(prev) && framingOf(shot) === framingOf(prev));
    if (clash && out.length + 2 <= budget.max_shots) {
      out.push(reactionHold(otherName(plan, shots, picturedOf(prev)), Math.min(2.5, budget.max_shot_s)));
      out.push({ ...shot });
    } else if (clash) {
      const other = otherName(plan, shots, picturedOf(prev));
      if (shot.dialogue) {
        out.push({
          ...shot,
          function: "listener_hold",
          speaker_on_camera: other,
          audio_role: "offscreen",
          mouth_visibility_required: false,
          camera: `Medium close-up of ${other}'s face, listening, mouth still`,
        });
      } else {
        out.push(reactionHold(other, Math.min(shot.duration_hint_seconds || 2, budget.max_shot_s)));
      }
    } else {
      out.push({ ...shot });
    }
    void index;
  }
  let guard = 0;
  while (out.length < budget.min_shots && guard++ < 40) {
    const insertAt = Math.max(1, out.length - 1);
    const pictured = picturedOf(out[insertAt - 1]!) ?? picturedOf(out[0]!);
    out.splice(insertAt, 0, reactionHold(otherName(plan, out, pictured), 2));
  }
  return out;
}

function injectCoverage(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  // BLOCK_CRAFT reuses length "60_90" for 15-min scene-blocks. Those still need
  // an establishing wide. Handbook ping-pong is only for a real short episode.
  const handbook =
    (budget.length === "60_90" && budget.min_shots >= 16) || budget.length === "30_45";
  let out = shots.map((shot) => ({ ...shot }));
  const hasComic = out.some((shot) => shot.comic_sting || shot.sfx === "comic" || shot.sfx === "glass" || shot.sfx === "stunned");
  if (handbook) {
    out = injectPingPong(out, plan, budget);
  } else {
    const hasWide = out.some(
      (shot) => shot.function === "establishing" || shot.type === "establishing" || /\bestablishing wide\b/i.test(shot.camera),
    );
    const location = plan.scenes[0]?.location ?? "night interior";
    const insertAt = Math.min(out.length - 1, 1);
    for (const shot of out) {
      if (shot.function === "stacked_two") {
        shot.function = "establishing";
        shot.camera = `establishing wide of ${location}, same key light, empty room, no people`;
        shot.speaker = null;
        shot.speaker_on_camera = null;
      }
    }
    if (!hasWide) {
      const wide: PlanShot = {
        type: "establishing",
        speaker: null,
        dialogue: null,
        emotion: null,
        delivery: null,
        pace: null,
        camera: `establishing wide of ${location}, same key light, empty room, no people`,
        mouth_visibility_required: false,
        duration_hint_seconds: 4,
        function: "establishing",
        audio_role: "silent",
        edit_mode: "locked_take",
        eyeline: "lens_forbidden",
        camera_move: "slow push",
      };
      if (out.length < budget.max_shots) out.splice(insertAt, 0, wide);
      else {
        const silent = out.find((shot, index) => index > 0 && index < out.length - 1 && !shot.dialogue);
        if (silent) Object.assign(silent, wide);
      }
    }
  }
  if (!hasComic) {
    const insert = out.find((shot) => shot.function === "insert_evidence" || shot.function === "phone_ui");
    if (insert) {
      insert.comic_sting = true;
      insert.sfx = insert.sfx ?? "stunned";
    }
  }
  return out;
}

function injectRecap(shots: PlanShot[], input: ValidatePlanInput, budget: LengthBudget): PlanShot[] {
  if ((input.length ?? "60_90") === "60_90") return shots;
  const episodeNumber = input.episodeNumber ?? 1;
  if (episodeNumber < 2 || shots.some((shot) => shot.recap)) return shots;
  const seconds = Math.min(4, Math.max(2, recapBudgetSeconds(episodeNumber)));
  const flash: PlanShot = {
    type: "broll",
    speaker: null,
    dialogue: null,
    emotion: null,
    delivery: null,
    pace: null,
    camera: `RECAP flash of ${insertObject(input.plan)}, object only, no people`,
    mouth_visibility_required: false,
    duration_hint_seconds: seconds,
    function: "insert_evidence",
    audio_role: "silent",
    edit_mode: "locked_take",
    eyeline: "lens_forbidden",
    recap: true,
  };
  return collapseToShotBudget([flash, ...shots], budget);
}

function sealBlock(shots: PlanShot[], plan: EpisodePlan, lastBlock: boolean, firstBlock: boolean): PlanShot[] {
  if (!shots.length) return shots;
  if (firstBlock) {
    const first = shots[0]!;
    if (!first.dialogue) {
      first.type = "broll";
      first.function = "hook_cu";
      first.audio_role = "silent";
      first.mouth_visibility_required = false;
    } else {
      first.function = first.function === "hook_cu" ? "hook_cu" : "accusation_cu";
    }
  }
  // Only the episode's first take is a hook_cu. A later "hook" is either an
  // accusation (spoken) or a mute-readable insert (silent); a silent face held
  // for four seconds under the hook label is the stare the lint forbids.
  for (const [index, shot] of shots.entries()) {
    if (shot.function !== "hook_cu") continue;
    if (firstBlock && index === 0) continue;
    if (shot.dialogue) {
      shot.function = "accusation_cu";
      shot.type = shot.type === "hero" ? "hero" : "dialogue";
    } else {
      shot.function = "insert_evidence";
      shot.type = "broll";
      shot.audio_role = "silent";
      shot.mouth_visibility_required = false;
      shot.camera = objectPlateCamera("insert_evidence", shot.camera);
    }
  }
  const last = shots[shots.length - 1]!;
  last.function = lastBlock ? "button_cu" : "block_button";
  last.eyeline = last.eyeline ?? "lens_forbidden";
  last.edit_mode = last.edit_mode ?? "locked_take";
  if (!last.dialogue || isNarrationLine(last.dialogue)) {
    // A button is a spoken turn. The episode's last block takes the
    // cliffhanger; every other block takes its outline button line.
    last.dialogue = lastBlock ? cliffLine(plan) : blockButtonLine(plan, last.block_index ?? null);
    last.speaker = last.speaker ?? last.speaker_on_camera ?? shots.find((shot) => shot.speaker)?.speaker ?? "Lead";
    last.speaker_on_camera = last.speaker;
    last.type = lastBlock ? "hero" : "dialogue";
    last.audio_role = "onscreen";
    last.mouth_visibility_required = true;
    last.silence_license = null;
    if (cameraIsObjectPlate(last.camera) || !cameraDescribesFace(last.camera)) {
      last.camera = `Tight single on ${last.speaker}'s face, eyes to the off-screen partner, one held breath before the line`;
    }
  }
  return shots;
}

/** The outline's button for a block, cut to a speakable line; a generic turn when the outline has none. */
function blockButtonLine(plan: EpisodePlan, blockIndex: number | null): string {
  const outline = (plan as { outline?: { blocks?: Array<{ index: number; button?: string; opens_hook?: string }> } }).outline;
  const block = outline?.blocks?.find((row) => row.index === blockIndex);
  for (const candidate of [block?.button, block?.opens_hook]) {
    const raw = (candidate ?? "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    // Prefer the speech the outline quotes; never speak the stage direction around it.
    const quoted = quotedSpeech(raw);
    const source = quoted ?? (isNarrationLine(raw) ? null : raw);
    if (!source) continue;
    const words = source.split(" ").filter(Boolean);
    if (words.length < 3) continue;
    const line = words.slice(0, DIALOGUE_MAX_WORDS).join(" ").replace(/[.,;:]+$/, "");
    return /[?!]$/.test(line) ? line : `${line}?`;
  }
  return "Then who signed it?";
}

function repairLongEpisodePlan(input: ValidatePlanInput): EpisodePlan {
  const episodeBudget = LENGTH_BUDGETS["900_1080"];
  const plan = applyShotBudget(input.plan, episodeBudget);
  // Twelve blocks at the 56 s block floor is 672 s, under the episode floor;
  // each block's floor is the episode floor shared across the blocks it has.
  const blockCount = Math.max(1, plan.scenes.length);
  const blockFloor = Math.min(
    BLOCK_CRAFT.duration_sum_max - 2,
    Math.max(BLOCK_CRAFT.duration_sum_min, Math.ceil(episodeBudget.duration_sum_min / blockCount) + 1),
  );
  const blockBudget: LengthBudget = { ...BLOCK_CRAFT, duration_sum_min: blockFloor, target_episode_seconds: Math.max(BLOCK_CRAFT.target_episode_seconds, blockFloor + 4) };
  const scenes: ShotPlanScene[] = plan.scenes.map((scene, sceneIndex) => {
    const lastBlock = sceneIndex === plan.scenes.length - 1;
    const firstBlock = sceneIndex === 0;
    let shots = scene.shots.map((shot, index, all) => craftShot(shot, index, all.length));
    shots = applyPads(shots, blockBudget);
    if (shots.length > blockBudget.max_shots) shots = collapseToShotBudget(shots, blockBudget);
    shots = growToWindow(shots, blockBudget);
    shots = sealBlock(shots, plan, lastBlock, firstBlock);
    shots = injectCoverage(shots, plan, blockBudget);
    shots = growToWindow(shots, blockBudget);
    shots = sealBlock(shots, plan, lastBlock, firstBlock);
    return {
      ...scene,
      block_index: scene.block_index ?? sceneIndex,
      kind: lastBlock ? ("button" as const) : (scene.kind ?? "dialogue"),
      shots: shots.map((shot) => ({
        ...shot,
        block_index: shot.block_index ?? scene.block_index ?? sceneIndex,
        function:
          lastBlock && shot === shots.at(-1)
            ? "button_cu"
            : shot.function === "button_cu" && !lastBlock
              ? "block_button"
              : shot.function,
      })),
    };
  });
  let flat = scenes.flatMap((scene) => scene.shots);
  if (flat.length > episodeBudget.max_shots) {
    const kept = scenes.map((scene) => ({
      ...scene,
      shots: collapseToShotBudget(scene.shots, {
        ...BLOCK_CRAFT,
        max_shots: Math.max(BLOCK_CRAFT.min_shots, Math.floor(episodeBudget.max_shots / scenes.length)),
      }),
    }));
    return {
      ...plan,
      hook: plan.hook?.trim() || flat[0]?.dialogue || "The turn is already happening.",
      cliffhanger: plan.cliffhanger?.trim() || "The door opens on the unpaid question.",
      scenes: kept,
    };
  }
  if (input.episodeNumber && input.episodeNumber >= 2 && !flat.some((shot) => shot.recap)) {
    const seconds = Math.min(4, Math.max(2, recapBudgetSeconds(input.episodeNumber)));
    const flash: PlanShot = {
      type: "broll",
      speaker: null,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: `RECAP flash of ${insertObject(input.plan)}, object only, no people`,
      mouth_visibility_required: false,
      duration_hint_seconds: seconds,
      function: "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      recap: true,
      block_index: 0,
    };
    scenes[0] = { ...scenes[0]!, shots: [flash, ...scenes[0]!.shots] };
  }
  // Every silence must be legal by the lint's own rule before the plan leaves
  // repair: readable inserts and wides may run to 8 s, anything else silent is
  // a priced 2.5 s reaction. The writer's stray silent singles never ship as
  // four-second stares, and a plan never dead-letters on ILLEGAL_SILENCE.
  for (const scene of scenes) {
    for (const [index, shot] of scene.shots.entries()) {
      if (shot.dialogue) continue;
      const prev = index > 0 ? scene.shots[index - 1] : undefined;
      if (silenceLegal(shot, prev)) continue;
      const readable =
        shot.function === "insert_evidence" || shot.function === "phone_ui" || shot.function === "establishing" || shot.function === "stacked_two" || shot.function === "name_plant" || shot.type === "broll" || shot.type === "establishing";
      if (readable) {
        shot.duration_hint_seconds = Math.min(8, shot.duration_hint_seconds);
        continue;
      }
      shot.type = "reaction";
      shot.function = "reaction";
      shot.audio_role = "silent";
      shot.mouth_visibility_required = false;
      shot.duration_hint_seconds = 2.5;
      shot.silence_license = shot.silence_license ?? "post_nuke";
    }
  }
  // An emotion node (reaction, insert, question, block edge) every 30 s: where
  // a run of statements would exceed it, cut to the listener for 2.5 s.
  {
    let clock = 0;
    let lastNode = 0;
    for (const scene of scenes) {
      const out: PlanShot[] = [];
      for (const [index, shot] of scene.shots.entries()) {
        const node =
          ["insert_evidence", "phone_ui", "slap_peak", "doorway_reveal", "block_button", "button_cu", "reaction"].includes(shot.function ?? "") ||
          index === 0 ||
          index === scene.shots.length - 1 ||
          Boolean(shot.dialogue && /\?/.test(shot.dialogue));
        if (!node && clock + shot.duration_hint_seconds - lastNode > 28) {
          const listener = scene.characters.find((name) => name !== shot.speaker) ?? scene.characters[0] ?? null;
          out.push({
            type: "reaction",
            speaker: listener,
            dialogue: null,
            emotion: "absorbing the blow",
            delivery: null,
            pace: null,
            camera: `Medium close-up of ${listener ?? "the listener"}'s face, listening, eyes down then up`,
            mouth_visibility_required: false,
            duration_hint_seconds: 2.5,
            function: "reaction",
            audio_role: "silent",
            edit_mode: "locked_take",
            eyeline: "lens_forbidden",
            silence_license: "post_nuke",
            block_index: shot.block_index,
          });
          clock += 2.5;
          lastNode = clock;
        }
        out.push(shot);
        clock += shot.duration_hint_seconds;
        if (node) lastNode = clock;
      }
      scene.shots = out;
    }
  }
  flat = scenes.flatMap((scene) => scene.shots);
  // Episode-level backstop: if the blocks still sum under the floor, lengthen
  // the shortest growable shots across the episode, spread evenly.
  let total = flat.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  if (total < episodeBudget.duration_sum_min) {
    let deficit = episodeBudget.duration_sum_min - total + 1;
    for (let pass = 0; pass < 6 && deficit > 0; pass += 1) {
      for (const shot of flat) {
        if (deficit <= 0) break;
        const cap = isSpokenLine(shot) ? episodeBudget.max_dialogue_s : episodeBudget.max_shot_s;
        if (shot.recap || shot.duration_hint_seconds >= cap) continue;
        const add = Math.min(0.5, cap - shot.duration_hint_seconds, deficit);
        shot.duration_hint_seconds = Number((shot.duration_hint_seconds + add).toFixed(2));
        deficit -= add;
      }
    }
    total = flat.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  }
  // And the symmetric ceiling: trim the longest shots first, never below the
  // length a line or a read needs.
  if (total > episodeBudget.duration_sum_max) {
    let excess = total - episodeBudget.duration_sum_max + 1;
    const floorFor = (shot: PlanShot) => {
      if (isSpokenLine(shot)) return Math.max(episodeBudget.min_shot_s, Math.min(shot.duration_hint_seconds, 3 + wordCount(shot.dialogue) * 0.35));
      const readable = shot.function === "insert_evidence" || shot.function === "phone_ui" || shot.function === "establishing" || shot.function === "stacked_two" || shot.type === "broll" || shot.type === "establishing";
      return readable ? 3 : 2.5;
    };
    for (let pass = 0; pass < 12 && excess > 0.05; pass += 1) {
      const room = flat.filter((shot) => !shot.recap && shot.duration_hint_seconds > floorFor(shot) + 0.05).sort((a, b) => b.duration_hint_seconds - a.duration_hint_seconds);
      if (!room.length) break;
      for (const shot of room) {
        if (excess <= 0) break;
        const cut = Math.min(0.5, shot.duration_hint_seconds - floorFor(shot), excess);
        shot.duration_hint_seconds = Number((shot.duration_hint_seconds - cut).toFixed(2));
        excess -= cut;
      }
    }
    total = flat.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  }
  return {
    ...plan,
    hook: plan.hook?.trim() || flat[0]?.dialogue || "The turn is already happening.",
    cliffhanger: plan.cliffhanger?.trim() || "The door opens on the unpaid question.",
    scenes,
  };
}

export function repairEpisodePlan(input: ValidatePlanInput): EpisodePlan {
  if (isLongFormLength(input.length)) return repairLongEpisodePlan(input);
  const budget = LENGTH_BUDGETS[input.length ?? "60_90"];
  let plan = applyShotBudget(input.plan, budget);
  let shots = plan.scenes
    .flatMap((scene, sceneIndex) => scene.shots.map((shot) => ({ ...shot, origin_scene: shot.origin_scene ?? sceneIndex })))
    .map((shot, index, all) => craftShot(shot, index, all.length));
  if (isMicroDramaSku(budget)) {
    shots = repairMicroDramaShots(shots, plan, budget, input.episodeNumber, input.namedCast);
    shots = collapseDuplicateButtons(shots);
    const head = plan.scenes[0] ?? { location: "interior", time: "night", characters: [] };
    let lastOrigin = shots.find((shot) => shot.origin_scene != null)?.origin_scene ?? 0;
    for (const shot of shots) {
      if (shot.origin_scene == null) shot.origin_scene = lastOrigin;
      else lastOrigin = shot.origin_scene;
    }
    const grouped = groupEditorialScenes(shots);
    const lastLine = shots.at(-1)?.dialogue;
    return {
      ...plan,
      hook: plan.hook?.trim() || shots[0]?.dialogue || "The turn is already happening.",
      cliffhanger: asksAQuestion(plan.cliffhanger)
        ? plan.cliffhanger.trim()
        : asksAQuestion(lastLine)
          ? lastLine!
          : cliffLine(plan),
      scenes: (grouped.length ? grouped : [{ kind: "dialogue" as const, shots, index: 0 }]).map((group) => {
        const origin = sceneMetaForGroup(group.shots, plan, head);
        return {
          location: isSceneTakeSku(budget) ? head.location : origin.location,
          time: origin.time,
          characters: uniqueNames(plan, group.shots),
          kind: group.kind,
          shots: group.shots,
        };
      }),
    };
  }
  shots = applyPads(shots, budget);
  shots = collapseToShotBudget(shots, budget);
  shots = growToWindow(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = collapseToShotBudget(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = growToWindow(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = growToWindow(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = injectRecap(shots, input, budget);
  shots = injectCoverage(shots, plan, budget);
  if (!shots.some((shot) => shot.function === "insert_evidence" || shot.function === "slap_peak" || shot.function === "phone_ui")) {
    const insertAt = Math.max(1, shots.length - 1);
    const room = shots.length < budget.max_shots;
    const plate: PlanShot = {
      type: "broll",
      speaker: null,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: `insert of ${insertObject(plan)}, no people, only the object`,
      mouth_visibility_required: false,
      duration_hint_seconds: 4,
      function: "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
    };
    if (room) shots.splice(insertAt, 0, plate);
    else {
      const silent = shots.find((shot, index) => index > 0 && index < shots.length - 1 && !shot.dialogue);
      if (silent) Object.assign(silent, plate);
    }
  }

  shots = collapseDuplicateButtons(shots);
  shots = injectPingPong(shots, plan, budget);
  shots = collapseToShotBudget(shots, budget);
  shots = growSpokenForSku(shots, budget);
  shots = growToWindow(shots, budget);
  shots = shrinkToWindow(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = collapseDuplicateButtons(shots);
  shots = collapseToShotBudget(shots, budget);
  shots = injectPingPong(shots, plan, budget);
  shots = collapseToShotBudget(shots, budget);
  shots = shrinkToWindow(shots, budget);
  shots = sealBeats(shots, plan, budget);
  shots = collapseToSceneTakes(shots, plan, budget);

  const head = plan.scenes[0] ?? { location: "interior", time: "night", characters: [] };
  // Injected shots (wide, insert, recap) carry no origin; they take the scene of the nearest planned shot.
  let lastOrigin = shots.find((shot) => shot.origin_scene != null)?.origin_scene ?? 0;
  for (const shot of shots) {
    if (shot.origin_scene == null) shot.origin_scene = lastOrigin;
    else lastOrigin = shot.origin_scene;
  }
  const grouped = groupEditorialScenes(shots);
  const lastLine = shots.at(-1)?.dialogue;
  return {
    ...plan,
    hook: plan.hook?.trim() || shots[0]?.dialogue || "The turn is already happening.",
    cliffhanger: asksAQuestion(plan.cliffhanger)
      ? plan.cliffhanger.trim()
      : asksAQuestion(lastLine)
        ? lastLine!
        : cliffLine(plan),
    scenes: (grouped.length ? grouped : [{ kind: "dialogue" as const, shots, index: 0 }]).map((group) => {
      const origin = sceneMetaForGroup(group.shots, plan, head);
      return {
        location: origin.location,
        time: origin.time,
        characters: uniqueNames(plan, group.shots),
        kind: group.kind,
        shots: group.shots,
      };
    }),
  };
}

/**
 * Location/time for a regrouped editorial scene: the planned scene most of its
 * shots came from. Regrouping used to flatten every scene onto the first one's
 * location, which is where mid-episode location jumps were born.
 */
function isSceneTakeSku(budget: LengthBudget): boolean {
  return budget.length === "60_90";
}

function isMicroDramaSku(budget: LengthBudget): boolean {
  return budget.length === "30_45" || budget.length === "60_90";
}

function cueSpeech(row: string): { speaker: string; text: string } | null {
  const match = row.match(/^([A-Za-z][A-Za-z0-9' .-]{0,40}):\s*(.+)$/);
  if (!match) return null;
  const text = match[2].replace(/\[[^\]]*\]/g, " ").trim();
  if (!text || /^[\W_]+$/.test(text)) return null;
  return { speaker: match[1].trim(), text };
}

function explodeSceneTakeToShots(shot: PlanShot, plan: EpisodePlan): PlanShot[] {
  const script = (typeof shot.scene_script === "string" ? shot.scene_script.trim() : "");
  const rows = script
    ? script.split("\n").map((line) => line.trim()).filter(Boolean).map(cueSpeech).filter((row): row is { speaker: string; text: string } => Boolean(row))
    : shot.dialogue
      ? [{ speaker: shot.speaker ?? plan.scenes[0]?.characters[0] ?? "SPEAKER", text: shot.dialogue }]
      : [];
  if (!rows.length) {
    return [{ ...shot, edit_mode: "locked_take", function: shot.function === "scene_take" ? "accusation_cu" : shot.function, scene_script: null }];
  }
  const names = uniqueNames(plan, [shot]);
  const out: PlanShot[] = [];
  for (const [index, row] of rows.entries()) {
    const listener = names.find((name) => name.split(/\s+/)[0]?.toLowerCase() !== row.speaker.split(/\s+/)[0]?.toLowerCase()) ?? names[0] ?? row.speaker;
    const sync: PlanShot = {
      ...shot,
      type: "dialogue",
      speaker: row.speaker,
      dialogue: row.text.split(/(?<=[.!?])\s+/)[0] ?? row.text,
      scene_script: null,
      edit_mode: "locked_take",
      audio_role: "onscreen",
      speaker_on_camera: row.speaker,
      speakers_off_camera: [],
      mouth_visibility_required: true,
      duration_hint_seconds: 5,
      function: index === 0 && shot.function === "hook_cu" ? "hook_cu" : "accusation_cu",
      hero: false,
    };
    out.push(sync);
    out.push({
      ...sync,
      type: "reaction",
      speaker: listener,
      dialogue: null,
      audio_role: "silent",
      speaker_on_camera: listener,
      mouth_visibility_required: false,
      duration_hint_seconds: 2,
      function: "reaction",
      silence_license: "post_nuke",
    });
  }
  return out;
}

function assignMicroChannels(shots: PlanShot[]): PlanShot[] {
  const spoken = shots
    .map((shot, index) => ({ shot, index }))
    .filter((row) => Boolean(row.shot.dialogue) && row.shot.audio_role !== "silent");
  const voTarget = Math.max(1, Math.round(spoken.length * 0.3));
  let vo = 0;
  return shots.map((shot, index) => {
    if (isSceneTake(shot)) {
      return { ...shot, edit_mode: "locked_take", function: shot.function === "scene_take" ? "accusation_cu" : shot.function, scene_script: null };
    }
    if (!shot.dialogue || shot.audio_role === "silent") return { ...shot, edit_mode: shot.edit_mode === "scene_take" ? "locked_take" : shot.edit_mode };
    const opener = index === 0;
    const closer = index === shots.length - 1;
    const spokenAt = spoken.findIndex((row) => row.index === index);
    const makeVo = !opener && !closer && vo < voTarget && spokenAt > 0 && spokenAt % 3 === 0;
    if (makeVo) vo += 1;
    return {
      ...shot,
      edit_mode: "locked_take",
      audio_role: makeVo ? "offscreen" : shot.audio_role === "offscreen" ? "offscreen" : "onscreen",
      speakers_off_camera: makeVo ? [shot.speaker].filter((name): name is string => Boolean(name)) : shot.speakers_off_camera,
      mouth_visibility_required: !makeVo,
      function: makeVo ? "listener_hold" : shot.function,
    };
  });
}

function growShotCount(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  const out = shots.map((shot) => ({ ...shot }));
  const names = uniqueNames(plan, out);
  let guard = 0;
  while (out.length < budget.min_shots && guard++ < 48) {
    const insertAt = Math.max(1, Math.min(out.length - 1, 1 + (guard % Math.max(1, out.length - 1))));
    const blocked = new Set(
      [picturedOf(out[insertAt - 1]!), picturedOf(out[insertAt]!)]
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase()),
    );
    const face =
      names.find((name) => !blocked.has(name.split(/\s+/)[0]!.toLowerCase())) ??
      names[guard % Math.max(1, names.length)] ??
      out[0]?.speaker ??
      "SPEAKER";
    if (guard % 3 === 0) {
      out.splice(insertAt, 0, {
        type: "broll",
        speaker: null,
        dialogue: null,
        emotion: null,
        delivery: null,
        pace: null,
        camera: "insert of the dated paper on marble, object only, no people",
        mouth_visibility_required: false,
        duration_hint_seconds: 3,
        function: "insert_evidence",
        audio_role: "silent",
        edit_mode: "locked_take",
        eyeline: "lens_forbidden",
        comic_sting: guard === 3,
        sfx: guard === 3 ? "paper" : null,
      });
      continue;
    }
    out.splice(insertAt, 0, {
      type: "reaction",
      speaker: face,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: `Medium close-up of ${face}, eyes off lens`,
      mouth_visibility_required: false,
      duration_hint_seconds: 2,
      function: "reaction",
      audio_role: "silent",
      speaker_on_camera: face,
      edit_mode: "locked_take",
      silence_license: "post_nuke",
    });
  }
  return out;
}

function demoteEstablishing(shots: PlanShot[]): PlanShot[] {
  return shots.map((shot) => {
    if (!isWideCoverage(shot) && shot.function !== "establishing" && shot.type !== "establishing") return shot;
    if (shot.dialogue) {
      const name = shot.speaker ?? shot.speaker_on_camera ?? "SPEAKER";
      return {
        ...shot,
        type: "dialogue",
        function: shot.function === "hook_cu" ? "hook_cu" : "accusation_cu",
        camera: `Tight single on ${name}'s face, eyes off lens`,
      };
    }
    return {
      ...shot,
      type: "broll",
      function: "insert_evidence",
      speaker: null,
      speaker_on_camera: null,
      camera: "insert of the dated paper on marble, object only, no people",
      audio_role: "silent",
      mouth_visibility_required: false,
      recap: false,
    };
  });
}

function breakAdjacentFaces(shots: PlanShot[], plan: EpisodePlan): PlanShot[] {
  const out = shots.map((shot) => ({ ...shot }));
  for (let index = 1; index < out.length; index += 1) {
    const prev = out[index - 1]!;
    const shot = out[index]!;
    const a = picturedOf(prev);
    const b = picturedOf(shot);
    if (!a || !b || a.toLowerCase() !== b.toLowerCase() || framingOf(prev) !== framingOf(shot)) continue;
    const other = otherName(plan, out, a);
    if (shot.dialogue) {
      out[index] = {
        ...shot,
        function: "listener_hold",
        audio_role: "offscreen",
        speaker_on_camera: other,
        mouth_visibility_required: false,
        camera: `Medium close-up of ${other}'s face, listening, mouth still`,
      };
    } else {
      out[index] = {
        ...shot,
        speaker: other,
        speaker_on_camera: other,
        camera: `Medium close-up of ${other}'s face, eyes off lens`,
      };
    }
  }
  return out;
}

function polishMicroCameras(shots: PlanShot[]): PlanShot[] {
  return shots.map((shot) => ({
    ...shot,
    camera: isObjectInsert(shot)
      ? objectPlateCamera(shot.function ?? "insert_evidence", shot.camera)
      : sanitizeCamera(shot.camera, {
          lockedTake: true,
          single: true,
          onCameraName: shot.speaker_on_camera ?? shot.speaker,
        }),
  }));
}

function splitSyncSentences(shots: PlanShot[]): PlanShot[] {
  const out: PlanShot[] = [];
  for (const shot of shots) {
    if (channelOf(shot) !== "sync" || isOneSentence(shot.dialogue)) {
      out.push(shot);
      continue;
    }
    const parts = (shot.dialogue ?? "")
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      const clipped = (shot.dialogue ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() || shot.dialogue;
      out.push({ ...shot, dialogue: clipped });
      continue;
    }
    for (const [index, text] of parts.entries()) {
      out.push({
        ...shot,
        dialogue: text,
        hero: index === parts.length - 1 ? shot.hero : false,
        function:
          index === 0 && shot.function === "hook_cu"
            ? "hook_cu"
            : shot.function === "button_cu" && index === parts.length - 1
              ? "button_cu"
              : "accusation_cu",
        duration_hint_seconds: Math.max(4, Math.min(shot.duration_hint_seconds || 4, 5)),
      });
    }
  }
  return out;
}

function ensureLeadsMeet(shots: PlanShot[], plan: EpisodePlan, episodeNumber?: number, namedCast?: string[]): PlanShot[] {
  if (episodeNumber !== 1 || shots.length < 3) return shots;
  const names = [...new Set([...(namedCast ?? []), ...uniqueNames(plan, shots)])];
  const first = (shots[0]?.speaker ?? names[0] ?? "").split(/\s+/)[0];
  const leads = new Set(
    shots.slice(0, 8).flatMap((shot) => {
      const fromScript = speakersForSceneTake({
        sceneScript: shot.scene_script,
        speaker: shot.speaker,
        speakerOnCamera: shot.speaker_on_camera,
      });
      return fromScript.length
        ? fromScript.map((name) => name.split(/\s+/)[0]!).filter(Boolean)
        : [(shot.speaker ?? "").split(/\s+/)[0]].filter(Boolean);
    }),
  );
  if (leads.size >= 2) return shots;
  const other =
    names.find((name) => name.split(/\s+/)[0]?.toLowerCase() !== first.toLowerCase()) ?? names[1];
  if (!other) return shots;
  const otherAt = shots.findIndex(
    (shot, index) =>
      index > 0 &&
      shot.dialogue &&
      (shot.speaker ?? "").split(/\s+/)[0]?.toLowerCase() === other.split(/\s+/)[0]?.toLowerCase(),
  );
  const out = shots.map((shot) => ({ ...shot }));
  if (otherAt > 0) {
    const [moved] = out.splice(otherAt, 1);
    out.splice(Math.min(2, out.length - 1), 0, moved!);
    return out;
  }
  if (shots.every((shot) => isSceneTake(shot))) {
    const head = out[0]!;
    const otherFirst = other.split(/\s+/)[0]!;
    const script = (head.scene_script ?? "").trim();
    if (script.toLowerCase().includes(otherFirst.toLowerCase())) return out;
    out[0] = {
      ...head,
      scene_script: `${script}\n${otherFirst}: ${hookLine(plan, head.speaker)}`.trim(),
    };
    return out;
  }
  out.splice(Math.min(2, out.length - 1), 0, {
    type: "dialogue",
    speaker: other,
    dialogue: hookLine(plan, other),
    emotion: "pressing",
    delivery: "direct",
    pace: null,
    camera: `Medium close-up of ${other} from the chest up, face in the upper third`,
    mouth_visibility_required: true,
    duration_hint_seconds: 4,
    function: "accusation_cu",
    audio_role: "onscreen",
    speaker_on_camera: other,
    edit_mode: "locked_take",
    eyeline: "lens_forbidden",
  });
  return out;
}

function repairMicroDramaShots(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget, episodeNumber?: number, namedCast?: string[]): PlanShot[] {
  if (isSceneTakeSku(budget)) {
    let packed = collapseToSceneTakes(shots, plan, budget);
    packed = ensureLeadsMeet(packed, plan, episodeNumber, namedCast);
    packed = collapseToSceneTakes(packed, plan, budget);
    packed = dropRepeatedBoundaryCues(packed);
    packed = sealSceneTakeEnds(packed, plan, budget);
    packed = fitSceneTakeSpeech(packed, plan, budget);
    packed = sealSceneTakeEnds(packed, plan, budget);
    packed = fitSceneTakeSpeech(packed, plan, budget);
    packed = lockSceneBlocking(packed, plan);
    return padSceneTakeDurations(packed, budget);
  }
  const exploded = shots.flatMap((shot) => (isSceneTake(shot) ? explodeSceneTakeToShots(shot, plan) : [{ ...shot, edit_mode: "locked_take" as const, scene_script: null }]));
  let next = demoteEstablishing(exploded);
  next = assignMicroChannels(next);
  next = splitSyncSentences(next);
  next = growShotCount(next, plan, budget);
  next = collapseToShotBudget(next, budget);
  next = growSpokenForSku(next, budget);
  next = growToWindow(next, budget);
  next = shrinkToWindow(next, budget);
  next = sealBeats(next, plan, budget);
  next = collapseDuplicateButtons(next);
  if (!next.some((shot) => shot.function === "insert_evidence" || shot.function === "phone_ui" || shot.function === "slap_peak")) {
    const insertAt = Math.max(1, next.length - 2);
    const plate: PlanShot = {
      type: "broll",
      speaker: null,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: "insert of the dated paper on marble, no people, only the object",
      mouth_visibility_required: false,
      duration_hint_seconds: 3,
      function: "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      comic_sting: true,
      sfx: "paper",
    };
    if (next.length < budget.max_shots) next.splice(insertAt, 0, plate);
  }
  next = demoteEstablishing(next);
  next = assignMicroChannels(next);
  next = breakAdjacentFaces(next, plan);
  next = growShotCount(next, plan, budget);
  next = growToWindow(next, budget);
  next = shrinkToWindow(next, budget);
  next = polishMicroCameras(next);
  next = splitSyncSentences(next);
  next = next.map((shot) => {
    if (!shot.dialogue) return shot;
    const words = shot.dialogue.trim().split(/\s+/).filter(Boolean);
    if (words.length <= DIALOGUE_MAX_WORDS) return shot;
    return { ...shot, dialogue: words.slice(0, DIALOGUE_MAX_WORDS).join(" ") };
  });
  for (let index = 1; index < next.length; index += 1) {
    const prev = next[index - 1]!;
    const shot = next[index]!;
    if (!prev.dialogue || !shot.dialogue || !dialogueTooClose(prev.dialogue, shot.dialogue)) continue;
    if (index === next.length - 1) {
      next[index - 1] = {
        ...prev,
        dialogue: null,
        audio_role: "silent",
        type: "reaction",
        function: "reaction",
        mouth_visibility_required: false,
        silence_license: "post_nuke",
      };
      continue;
    }
    next[index] = {
      ...shot,
      dialogue: null,
      audio_role: "silent",
      type: "reaction",
      function: "reaction",
      mouth_visibility_required: false,
      silence_license: "post_nuke",
    };
  }
  next = next.map((shot) => {
    if (shot.dialogue) return shot;
    if (
      shot.function === "insert_evidence" ||
      shot.function === "phone_ui" ||
      shot.type === "broll" ||
      shot.type === "establishing"
    ) {
      return shot;
    }
    return {
      ...shot,
      silence_license: shot.silence_license ?? "post_nuke",
      duration_hint_seconds: Math.min(2.5, shot.duration_hint_seconds || 2.5),
      mouth_visibility_required: false,
    };
  });
  next = ensureLeadsMeet(next, plan, episodeNumber, namedCast);
  if (next[0]) next[0] = { ...next[0], function: "hook_cu" };
  if (next.at(-1)) next[next.length - 1] = { ...next[next.length - 1]!, function: "button_cu", hero: true };
  return next;
}

/**
 * Who says the button. A reply lands harder than a repeat, so it goes to
 * whoever did not speak the cue before it — and never to someone the line
 * names, because nobody says their own name at themselves.
 */
function buttonSpeaker(script: string, button: string, last: PlanShot, plan: EpisodePlan): string {
  const firstOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
  const rows = cueRows(script);
  const inScript = [...new Set(rows.map((row) => firstOf(row.split(":")[0])).filter(Boolean))];
  // The leads carry the show. The cliffhanger is theirs even when a third
  // person had the last word, so the roster is ordered leads first.
  const leads = uniqueNames(plan, plan.scenes.flatMap((scene) => scene.shots)).map(firstOf).filter(Boolean).slice(0, 2);
  const roster = [...new Set([...leads, ...inScript])].filter(Boolean);
  const previous = firstOf(rows.at(-1)?.split(":")[0]);
  const named = roster.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(button));
  const legal = roster.filter((name) => !named.some((row) => row.toLowerCase() === name.toLowerCase()));
  const pool = legal.length ? legal : roster;
  return (
    pool.find((name) => name.toLowerCase() !== previous.toLowerCase()) ??
    pool[0] ??
    firstOf(last.speaker ?? last.speaker_on_camera) ??
    "SPEAKER"
  );
}

/**
 * Writers overlap takes for continuity — they repeat the previous take's last
 * line as the next take's first. On screen that is the actor saying the same
 * sentence twice, so the repeat is dropped and the continuity is carried by
 * the blocking's start_from instead.
 */
function dropRepeatedBoundaryCues(takes: PlanShot[]): PlanShot[] {
  const out = takes.map((take) => ({ ...take }));
  for (let i = 1; i < out.length; i += 1) {
    const previous = cueRows(out[i - 1]!.scene_script).map(cueText);
    const rows = cueRows(out[i]!.scene_script);
    // An echo can sit anywhere in the take, not only at the seam, and a
    // paraphrase of the previous line is the same repeat to a viewer. Drop each
    // one while the take still holds a conversation.
    const kept: string[] = [];
    // Five cues is the floor for a non-button conversation. The button may be 1–4.
    let budget = rows.length - (i === out.length - 1 ? 1 : 5);
    for (const row of rows) {
      if (budget > 0 && previous.some((said) => dialogueTooClose(cueText(row), said))) {
        budget -= 1;
        continue;
      }
      kept.push(row);
    }
    if (kept.length === rows.length) continue;
    out[i] = { ...out[i]!, scene_script: kept.join("\n"), dialogue: cueText(kept[0] ?? out[i]!.dialogue ?? "") };
  }
  return out;
}

function sealSceneTakeEnds(takes: PlanShot[], plan: EpisodePlan, budget?: LengthBudget): PlanShot[] {
  if (!takes.length) return takes;
  const out = takes.map((shot) => ({ ...shot }));
  const first = out[0]!;
  const live =
    (first.scene_script ?? "")
      .split("\n")
      .map(cueText)
      .find((line) => lineInMotion(line)) ??
    (lineInMotion(first.dialogue) ? first.dialogue : null) ??
    hookLine(plan, first.speaker);
  if (live) out[0] = { ...first, function: "hook_cu", dialogue: live };
  const last = out[out.length - 1]!;
  const ask =
    (last.scene_script ?? "")
      .split("\n")
      .map(cueText)
      .reverse()
      .find((line) => asksOrFallsBack(line) && !dialogueTooClose(line, out[0]?.dialogue) && !dialogueTooClose(line, plan.hook)) ??
    last.dialogue;
  const button =
    ask && asksOrFallsBack(ask) && !dialogueTooClose(ask, out[0]?.dialogue) && !dialogueTooClose(ask, plan.hook)
      ? ask
      : cliffLine(plan);
  const script = (last.scene_script ?? "").trim();
  const buttonName = buttonSpeaker(script, button, last, plan);
  const scriptHasButton = script.split("\n").map(cueText).some((line) => line === button);
  const buttonCue = `${buttonName}: ${button}`;
  const appended = scriptHasButton ? script : `${script}\n${buttonCue}`.trim();
  const maxS = budget?.max_shot_s ?? 15;
  let nextScript = appended;
  if (spokenSeconds(cueRows(appended)) > maxS + 0.25) {
    const rows = cueRows(script);
    if (rows.length) rows[rows.length - 1] = buttonCue;
    else rows.push(buttonCue);
    nextScript = rows.join("\n");
  }
  out[out.length - 1] = {
    ...last,
    function: "button_cu",
    hero: true,
    dialogue: button,
    scene_script: nextScript,
  };
  return out;
}

function locationOfTake(take: PlanShot, plan: EpisodePlan): string {
  return plan.scenes[take.origin_scene ?? 0]?.location ?? "";
}

function rebuildSceneTake(
  source: PlanShot,
  cues: string[],
  index: number,
  total: number,
  budget: LengthBudget,
  plan: EpisodePlan,
): PlanShot {
  const first = cues[0] ?? `${source.speaker ?? "SPEAKER"}: ${hookLine(plan, source.speaker)}`;
  const last = cues.at(-1) ?? first;
  const firstName = first.split(":")[0]?.trim() || source.speaker;
  const lastName = last.split(":")[0]?.trim() || source.speaker;
  const opener = index === 0;
  const closer = index === total - 1;
  const punch = hookLine(plan, source.speaker);
  const firstLive =
    cues.map(cueText).find((line) => lineInMotion(line)) ??
    (opener && lineInMotion(source.dialogue) ? source.dialogue : null) ??
    (opener ? punch : cueText(first));
  const nextCues = (
    opener && firstLive && !cues.some((row) => cueText(row) === firstLive)
      ? [`${firstName}: ${firstLive}`, ...cues.slice(1)]
      : cues
  ).map((row) => clipCueToBreath(row));
  return {
    ...source,
    speaker: (closer ? lastName : firstName) ?? source.speaker,
    speaker_on_camera: (closer ? lastName : firstName) ?? source.speaker_on_camera,
    dialogue: closer ? cueText(last) : opener ? firstLive : cueText(first),
    scene_script: nextCues.join("\n"),
    // Speech plus one breath. Padding a short conversation to the model max is dead air.
    duration_hint_seconds: Math.min(budget.max_shot_s, Math.max(budget.min_shot_s, Math.ceil(spokenSeconds(nextCues) + 1))),
    function: opener ? ("hook_cu" as const) : closer ? ("button_cu" as const) : ("scene_take" as const),
    hero: closer,
    edit_mode: "scene_take",
  };
}

function fitSceneTakeSpeech(takes: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  if (!takes.length) return takes;
  // One sentence per cue before fitting, so the window is measured on spoken
  // units. Each cue remembers the take it was written for: staging describes
  // the bodies saying these words, so when a cue moves its staging moves too.
  type Cue = { text: string; origin: number };
  const queue = takes.map((source, origin) => ({
    source,
    cues: splitCueSentences(cueRows(source.scene_script)).map((text) => ({ text: clipCueToBreath(text), origin })),
  }));
  const packed: Array<{ cues: Cue[] }> = [];
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i]!;
    let cues = item.cues.filter((cue) => cue.text);
    const loc = locationOfTake(item.source, plan);
    while (cues.length) {
      const { keep } = fitCueRows(cues.map((cue) => cue.text), budget.max_shot_s);
      const kept = cues.slice(0, keep.length).map((cue, index) => ({ ...cue, text: keep[index] ?? cue.text }));
      const overflow = cues.slice(keep.length);
      packed.push({ cues: kept });
      if (!overflow.length) break;
      const next = queue[i + 1];
      if (next && locationOfTake(next.source, plan) === loc) {
        next.cues = [...overflow, ...next.cues];
        break;
      }
      const reserved = queue.length - i - 1;
      if (packed.length + reserved < budget.max_shots) {
        cues = overflow;
        continue;
      }
      break;
    }
  }
  const kept = packed.filter((row) => row.cues.length).slice(0, budget.max_shots);
  if (!kept.length) return takes;
  // Non-button takes target 5–8 cues. Steal surplus from the next take — never
  // invent lines, never empty the button, never cross a staging origin.
  for (let i = 0; i < kept.length - 1; i += 1) {
    const nextFloor = i + 1 === kept.length - 1 ? 1 : 5;
    while (
      kept[i]!.cues.length < 5 &&
      kept[i + 1]!.cues.length > nextFloor &&
      kept[i + 1]!.cues[0]!.origin === kept[i]!.cues[0]!.origin
    ) {
      kept[i]!.cues.push(kept[i + 1]!.cues.shift()!);
    }
  }
  // Merge adjacent thin non-button takes of the same origin when we have a spare slot.
  for (let i = 0; i < kept.length - 1; ) {
    const nextIsButton = i + 1 === kept.length - 1;
    if (
      !nextIsButton &&
      kept[i]!.cues.length < 5 &&
      kept.length > budget.min_shots &&
      kept[i + 1]!.cues[0]!.origin === kept[i]!.cues[0]!.origin
    ) {
      kept[i]!.cues.push(...kept[i + 1]!.cues);
      kept.splice(i + 1, 1);
      continue;
    }
    i += 1;
  }
  return kept.map((row, index) =>
    rebuildSceneTake(
      takes[row.cues[0]!.origin] ?? takes[0]!,
      row.cues.map((cue) => cue.text),
      index,
      kept.length,
      budget,
      plan,
    ),
  );
}

function lockSceneBlocking(takes: PlanShot[], plan: EpisodePlan): PlanShot[] {
  const props = new Map<string, string>();
  const stagingByLoc = new Map<string, string>();
  const anchorByLoc = new Map<string, string>();
  const firstNames = speakersForSceneTake({
    sceneScript: takes[0]?.scene_script,
    speaker: takes[0]?.speaker,
    speakerOnCamera: takes[0]?.speaker_on_camera,
  });
  const episodeSides = assignSceneSides(firstNames, takes[0]?.blocking);
  const ledger = presenceLedger(
    takes.map((take, index) => ({
      speakers: speakersForSceneTake({
        sceneScript: take.scene_script,
        speaker: take.speaker,
        speakerOnCamera: take.speaker_on_camera,
      }),
      script: take.scene_script,
      sameRoomAsPrevious: index > 0 && locationOfTake(takes[index - 1]!, plan) === locationOfTake(take, plan),
    })),
  );
  const cast = uniqueNames(plan, takes);
  return takes.map((take, index) => {
    const loc = locationOfTake(take, plan);
    const roster = ledger[index]!;
    // A cast member the staging places in frame is in the room even if silent
    // (FELIX stopped at the alley mouth). Their face must be packed too.
    const staged = cast.filter(
      (name) =>
        new RegExp(`\\b${name.split(/\s+/)[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(take.blocking?.staging ?? "") &&
        !roster.present.some((row) => row.toLowerCase().split(/\s+/)[0] === name.toLowerCase().split(/\s+/)[0]),
    );
    if (staged.length) {
      roster.present = [...roster.present, ...staged].slice(0, 3);
      roster.enters = [...roster.enters, ...staged.filter((name) => index === 0 || !ledger[index - 1]!.present.some((row) => row.toLowerCase() === name.toLowerCase()))];
    }
    const names = roster.present;
    const locked = episodeSides;
    const prev = index > 0 ? takes[index - 1] : null;
    const sameRoom = Boolean(prev && locationOfTake(prev, plan) === loc);
    const prop = props.get(loc) ?? inferPropLock(`${take.camera}\n${take.scene_script}\n${prev?.camera ?? ""}`);
    props.set(loc, prop);
    const lastCue = sameRoom ? cueRows(prev?.scene_script).at(-1) : null;
    const leftStance =
      take.blocking?.left_gesture ?? takes[0]?.blocking?.left_gesture ?? "holds the position and posture written in STAGING, hands visible, does not walk";
    const rightStance =
      take.blocking?.right_gesture ?? takes[0]?.blocking?.right_gesture ?? "holds the position and posture written in STAGING, hands visible, does not walk";
    // Staging is the planner's physics. A take without its own inherits the last
    // one in the room, so nobody teleports from the floor to a table.
    const previousStaging = sameRoom ? stagingByLoc.get(loc) ?? null : null;
    const staging = take.blocking?.staging?.trim() || (previousStaging ? `${previousStaging}; same positions as the previous take` : null);
    if (take.blocking?.staging?.trim()) stagingByLoc.set(loc, take.blocking.staging.trim());
    const anchor = take.blocking?.anchor?.trim() || anchorByLoc.get(loc) || null;
    if (anchor) anchorByLoc.set(loc, anchor);
    const { coverage, pictured } = coverageForTake(index, takes.length, [locked.camera_left, locked.camera_right].filter(Boolean) as string[], take.emotion);
    const blocking: SceneBlocking = {
      camera_left: locked.camera_left,
      camera_right: locked.camera_right,
      prop,
      left_gesture: leftStance,
      right_gesture: rightStance,
      staging,
      anchor,
      start_from: lastCue
        ? "They have just finished the last spoken line. Same sides. Same staging. Same prop. Do not reset the room. Do not repeat that line. JOIN CUT: open closer — a close-up or both faces stacked. Do not reprint the last frame."
        : null,
      coverage,
      pictured,
      present: roster.present,
      enters: roster.enters,
      exits: roster.exits,
      upper_frame: upperFrameFor(
        [locked.camera_left, locked.camera_right].filter((name): name is string => Boolean(name)),
        takes[0]?.blocking?.upper_frame ?? take.blocking?.upper_frame,
      ),
    };
    const onCamera = coverage === "single" || coverage === "cu" ? pictured ?? take.speaker : take.speaker_on_camera ?? take.speaker;
    return {
      ...take,
      blocking,
      camera: coverageCamera(blocking, names, index),
      speaker_on_camera: onCamera,
    };
  });
}

function sceneTakeCamera(group: PlanShot[], pictured: string[]): string {
  const inherited = group.find((shot) => shot.camera && !cameraIsObjectPlate(shot.camera))?.camera ?? "";
  if (inherited && !/\b(close-up|ecu|tight single|extreme close)\b/i.test(inherited)) return inherited;
  return `3/4 two-shot, ${pictured.join(" and ") || "both people"} in the same place, the locked prop between them, not a flat side-profile, never the lens — Shot 1 only`;
}

function packSceneTake(
  group: PlanShot[],
  plan: EpisodePlan,
  budget: LengthBudget,
  index: number,
  total: number,
  origin: number,
  copiedInheritedScript: boolean,
): PlanShot {
  const spoken = group.filter((shot) => isSpokenLine(shot));
  const lines = linesForPackedTake(group, copiedInheritedScript);
  const spokenLines = spoken.map((shot) => cueLine(shot));
  if (lines.length < 5 && index < total - 1) {
    for (const row of spokenLines) {
      if (!lines.includes(row)) lines.push(row);
    }
  }
  const names = uniqueNames(plan, group);
  const script = lines.join("\n");
  const pictured = speakersForSceneTake({
    sceneScript: script,
    speaker: spoken[0]?.speaker ?? names[0],
    speakerOnCamera: spoken[1]?.speaker ?? spoken[0]?.speaker_on_camera ?? names[1],
  });
  const firstSpoken = spoken.find((shot) => lineInMotion(shot.dialogue)) ?? spoken[0] ?? group[0]!;
  const lastSpoken = [...spoken].reverse().find((shot) => asksOrFallsBack(shot.dialogue)) ?? spoken.at(-1) ?? group.at(-1)!;
  const opener = index === 0;
  const last = index === total - 1;
  const scriptAsk = [...lines].reverse().map((row) => row.replace(/^[A-Za-z][A-Za-z0-9' .-]{0,40}:\s*/, "").trim()).find((line) => asksOrFallsBack(line));
  const rawLast = scriptAsk || lastSpoken.dialogue?.trim() || "";
  let buttonLine = last && !asksOrFallsBack(rawLast) ? cliffLine(plan) : rawLast;
  if (last && (dialogueTooClose(buttonLine, firstSpoken.dialogue) || dialogueTooClose(buttonLine, plan.hook))) buttonLine = cliffLine(plan);
  let openerLine = (opener ? firstSpoken.dialogue : last ? buttonLine || lastSpoken.dialogue : firstSpoken.dialogue)?.trim()
    || lines[0]?.replace(/^\w+:\s*/, "")
    || hookLine(plan, firstSpoken.speaker);
  if (opener && !openerLine.includes("?") && /\b(where|who|why|how|what)\b/i.test(openerLine)) {
    openerLine = `${openerLine.replace(/[.!]+$/, "")}?`;
  }
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const seconds = Math.min(
    budget.max_shot_s,
    Math.max(budget.min_shot_s, Math.round(Math.max(budget.min_shot_s, words / 2.4 + 2))),
  );
  return {
    type: "dialogue" as const,
    speaker: (last ? lastSpoken.speaker : firstSpoken.speaker) ?? names[0] ?? null,
    dialogue: last ? (buttonLine || lastSpoken.dialogue || openerLine) : openerLine,
    scene_script: script || `${names[0] ?? "SPEAKER"}: ${openerLine}`,
    emotion: firstSpoken.emotion ?? "pressing",
    delivery: firstSpoken.delivery ?? "direct",
    pace: firstSpoken.pace ?? "medium",
    camera: sceneTakeCamera(group, pictured),
    mouth_visibility_required: true,
    duration_hint_seconds: seconds,
    hero: last,
    edit_mode: "scene_take" as const,
    audio_role: "onscreen" as const,
    speaker_on_camera: (last ? lastSpoken.speaker : firstSpoken.speaker) ?? names[0] ?? null,
    speakers_off_camera: [],
    eyeline: "lens_forbidden" as const,
    function: opener ? ("hook_cu" as const) : last ? ("button_cu" as const) : ("scene_take" as const),
    origin_scene: origin,
    // A sting on the opener is a trailer whoosh over the first line. Keep it
    // for the cliff and for comic turns later in the episode.
    comic_sting: !opener && (group.some((shot) => shot.comic_sting) || last),
    sfx: group.find((shot) => shot.sfx)?.sfx ?? (last ? "paper" : null),
    // The planner's staging, anchor, sides and upper frame are the physics of the
    // take; rebuilding the cues must not throw them away.
    blocking: mergeBlocking(group),
  };
}

function mergeBlocking(group: readonly PlanShot[]): PlanShot["blocking"] | undefined {
  const rows = group.map((shot) => shot.blocking).filter((row): row is NonNullable<PlanShot["blocking"]> => Boolean(row));
  if (!rows.length) return undefined;
  const pick = <K extends keyof NonNullable<PlanShot["blocking"]>>(key: K) =>
    rows.map((row) => row[key]).find((value) => value != null && String(value).trim() !== "");
  return {
    camera_left: pick("camera_left") ?? null,
    camera_right: pick("camera_right") ?? null,
    prop: pick("prop") ?? null,
    left_gesture: pick("left_gesture") ?? null,
    right_gesture: pick("right_gesture") ?? null,
    upper_frame: pick("upper_frame") ?? null,
    staging: pick("staging") ?? null,
    anchor: pick("anchor") ?? null,
  };
}

function asksOrFallsBack(line: string | null | undefined): boolean {
  return Boolean(line && (/[?]/.test(line) || /\b(who|whose|then)\b/i.test(line)));
}

function chunkRows<T>(rows: T[], count: number): T[][] {
  if (!rows.length) return [[]];
  const n = Math.max(1, Math.min(count, rows.length));
  const size = Math.ceil(rows.length / n);
  const chunks: T[][] = [];
  for (let i = 0; i < n; i += 1) {
    const start = i * size;
    const end = i === n - 1 ? rows.length : Math.min(rows.length, start + size);
    if (start < rows.length) chunks.push(rows.slice(start, end));
  }
  return chunks.length ? chunks : [rows];
}

function padSceneTakeDurations(takes: PlanShot[], budget: LengthBudget): PlanShot[] {
  if (!takes.length) return takes;
  const each = Math.min(
    budget.max_shot_s,
    Math.max(budget.min_shot_s, Math.ceil(budget.duration_sum_min / takes.length)),
  );
  return takes.map((shot) => ({
    ...shot,
    duration_hint_seconds: Math.min(budget.max_shot_s, Math.max(each, shot.duration_hint_seconds)),
  }));
}

function collapseToSceneTakes(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  if (!isSceneTakeSku(budget)) return shots;
  // Always rebuild. The writer may stamp edit_mode=scene_take on ECU singles;
  // those are still coverage and fail COVERAGE_MIX.
  const byScene = new Map<number, PlanShot[]>();
  for (const shot of shots) {
    const key = shot.origin_scene ?? 0;
    const group = byScene.get(key) ?? [];
    group.push(shot);
    byScene.set(key, group);
  }
  const keys = [...byScene.keys()].sort((a, b) => a - b);
  const spoken = shots.filter((shot) => isSpokenLine(shot));
  const target = Math.min(
    budget.max_shots,
    Math.max(budget.min_shots, keys.length >= budget.min_shots ? keys.length : Math.min(budget.max_shots, Math.max(budget.min_shots, spoken.length || 1))),
  );
  const groups: Array<{ rows: PlanShot[]; origin: number }> =
    keys.length >= budget.min_shots
      ? keys.map((key) => ({ rows: byScene.get(key)!, origin: key }))
      : chunkRows(spoken.length ? spoken : shots, target).map((rows, index) => ({
          rows,
          origin: rows[0]?.origin_scene ?? index,
        }));
  const trimmed = groups.length > budget.max_shots
    ? groups.slice(0, budget.max_shots - 1).concat([{
        rows: groups.slice(budget.max_shots - 1).flatMap((group) => group.rows),
        origin: groups[budget.max_shots - 1]?.origin ?? 0,
      }])
    : groups;
  while (trimmed.length < budget.min_shots) {
    const splitAt = trimmed.reduce((best, group, index) => (group.rows.length > trimmed[best]!.rows.length ? index : best), 0);
    const longest = trimmed[splitAt]!;
    if (longest.rows.length < 2) break;
    const mid = Math.ceil(longest.rows.length / 2);
    trimmed.splice(splitAt, 1, { rows: longest.rows.slice(0, mid), origin: longest.origin }, { rows: longest.rows.slice(mid), origin: longest.origin });
  }
  const inheritedCopies = new Map<string, number>();
  for (const group of trimmed) {
    const inherited = inheritedSceneScript(group.rows);
    if (inherited) inheritedCopies.set(inherited, (inheritedCopies.get(inherited) ?? 0) + 1);
  }
  return uniquifyPackedSceneTakes(
    padSceneTakeDurations(
      trimmed.map((group, index) => {
        const inherited = inheritedSceneScript(group.rows);
        return packSceneTake(
          group.rows,
          plan,
          budget,
          index,
          trimmed.length,
          group.origin,
          Boolean(inherited && (inheritedCopies.get(inherited) ?? 0) > 1),
        );
      }),
      budget,
    ),
    budget,
  );
}

function cueLine(shot: PlanShot): string {
  const name = (shot.speaker ?? shot.speaker_on_camera ?? "").split(/\s+/)[0] || "SPEAKER";
  return `${name}: ${shot.dialogue}`;
}

function inheritedSceneScript(group: PlanShot[]): string | null {
  const unique = [
    ...new Set(
      group
        .map((shot) => (typeof shot.scene_script === "string" ? shot.scene_script.trim() : ""))
        .filter((text): text is string => Boolean(text && text.includes("\n"))),
    ),
  ];
  return unique.length === 1 ? unique[0]! : null;
}

/**
 * A coverage row often carries the whole scene's script. If we keep that
 * inherited script when splitting one scene into several takes, every take
 * says the same lines and we pay Seedance twice.
 */
function linesForPackedTake(group: PlanShot[], copiedInheritedScript: boolean): string[] {
  const uniqueScripts = [
    ...new Set(
      group
        .map((shot) => (typeof shot.scene_script === "string" ? shot.scene_script.trim() : ""))
        .filter((text): text is string => Boolean(text && text.includes("\n"))),
    ),
  ];
  if (copiedInheritedScript) {
    return group.filter((shot) => isSpokenLine(shot)).map((shot) => cueLine(shot));
  }
  if (group.length === 1 && uniqueScripts.length === 1) {
    return uniqueScripts[0]!.split("\n").map((row) => row.trim()).filter(Boolean);
  }
  if (uniqueScripts.length === 1 && group.length > 1) {
    return group.filter((shot) => isSpokenLine(shot)).map((shot) => cueLine(shot));
  }
  if (uniqueScripts.length > 1) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const script of uniqueScripts) {
      for (const row of script.split("\n").map((line) => line.trim()).filter(Boolean)) {
        if (seen.has(row)) continue;
        seen.add(row);
        lines.push(row);
      }
    }
    return lines;
  }
  return group.filter((shot) => isSpokenLine(shot)).map((shot) => cueLine(shot));
}

function uniquifyPackedSceneTakes(takes: PlanShot[], budget: LengthBudget): PlanShot[] {
  const kept: PlanShot[] = [];
  for (const take of takes) {
    if (kept.some((prev) => sceneTakesAreCopies(prev, take))) continue;
    kept.push(take);
  }
  if (kept.length === takes.length || kept.length === 0) return takes;
  return padSceneTakeDurations(
    kept.map((shot, index) => ({
      ...shot,
      function: index === 0 ? ("hook_cu" as const) : index === kept.length - 1 ? ("button_cu" as const) : ("scene_take" as const),
      hero: index === kept.length - 1,
    })),
    budget,
  );
}

function sceneMetaForGroup(
  shots: readonly PlanShot[],
  plan: EpisodePlan,
  head: { location: string; time: string },
): { location: string; time: string } {
  const counts = new Map<number, number>();
  for (const shot of shots) {
    if (shot.origin_scene == null) continue;
    counts.set(shot.origin_scene, (counts.get(shot.origin_scene) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      best = index;
      bestCount = count;
    }
  }
  const scene = best == null ? null : plan.scenes[best];
  return { location: scene?.location || head.location, time: scene?.time || head.time };
}
