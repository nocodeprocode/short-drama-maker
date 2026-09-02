import type { EpisodePlan, ShotPlanScene } from "../../engine/domain.ts";
import { cameraDescribesFace, objectPlateCamera } from "../craft/prompt-fragments.ts";
import { groupEditorialScenes } from "../editorial/scene-groups.ts";
import { cameraIsObjectPlate, isObjectInsert } from "../types/editorial.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import {
  applyShotBudget,
  clampDuration,
  collapseToShotBudget,
  defaultCraftForShot,
} from "../editorial/shot-budget.ts";
import { consumeReactionPad, silenceLegal } from "../pacing/reaction-pad.ts";
import { DIALOGUE_MAX_WORDS, dialogueTooClose, wordCount } from "../types/dialogue.ts";
import { LENGTH_BUDGETS, type LengthBudget } from "../types/pacing.ts";
import { isLongFormLength } from "../../engine/config/catalog.ts";
import { recapBudgetSeconds } from "../plans/index.ts";
import { lineInMotion, type ValidatePlanInput } from "./validate-plan.ts";

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
  const names = [
    ...plan.scenes.flatMap((scene) => scene.characters),
    ...shots.map((shot) => shot.speaker).filter((name): name is string => Boolean(name)),
  ];
  return [...new Set(names)];
}

function isNarrationLine(text: string | null | undefined): boolean {
  if (!text) return true;
  return /\b(mouth opens|camera holds|we see|the camera|opens — and closes)\b/i.test(text);
}

const FALLBACK_BUTTONS = [
  "Then whose name is on it?",
  "Who sent you up?",
  "Say the name on the paper.",
  "Who is waiting downstairs?",
];

function cliffLine(plan: EpisodePlan): string {
  const shots = plan.scenes.flatMap((scene) => scene.shots);
  const banned = [shots[0]?.dialogue, plan.hook];
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
  return FALLBACK_BUTTONS.find((line) => !banned.some((hook) => dialogueTooClose(line, hook))) ?? FALLBACK_BUTTONS[0]!;
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
      : sanitizeCamera(shot.camera, { lockedTake: craft.edit_mode === "locked_take" }),
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
  const floor = budget.length === "30_45" ? 5 : 6;
  return shots.map((shot) => {
    if (shot.silence_license === "post_nuke" || shot.silence_license === "post_slap") return shot;
    if (!isSpokenLine(shot) && shot.function !== "button_cu") return shot;
    return {
      ...shot,
      duration_hint_seconds: clampDuration(Math.max(floor, shot.duration_hint_seconds), budget, true),
    };
  });
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
    first.type = "broll";
    first.function = "hook_cu";
    first.audio_role = "silent";
    first.mouth_visibility_required = false;
    first.silence_license = null;
    first.hero = false;
    first.duration_hint_seconds = clampDuration(Math.max(4, first.duration_hint_seconds), budget, false);
  } else {
    first.function = "hook_cu";
    first.type = first.type === "hero" ? "hero" : "dialogue";
  }
  first.eyeline = first.eyeline ?? "lens_forbidden";
  first.edit_mode = first.edit_mode ?? "locked_take";

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
    dialogueTooClose(last.dialogue, first.dialogue) ||
    dialogueTooClose(last.dialogue, plan.hook)
  ) {
    last.dialogue = cliffLine(plan);
    last.mouth_visibility_required = true;
    last.audio_role = "onscreen";
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

function injectCoverage(shots: PlanShot[], plan: EpisodePlan, budget: LengthBudget): PlanShot[] {
  const out = shots.map((shot) => ({ ...shot }));
  const named = uniqueNames(plan, out);
  const hasWide = out.some(
    (shot) => shot.function === "establishing" || shot.type === "establishing" || /\bestablishing wide\b/i.test(shot.camera),
  );
  const hasComic = out.some((shot) => shot.comic_sting || shot.sfx === "comic" || shot.sfx === "glass" || shot.sfx === "stunned");
  const location = plan.scenes[0]?.location ?? "night interior";
  const insertAt = Math.min(out.length - 1, 1);
  // Two-shots are never injected: without a locked group still every video model
  // invents a second person. Coverage variety comes from the empty wide + insert.
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
    camera: "RECAP flash of last episode's dated receipt or desk pad, object only, no people",
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
  const raw = (block?.button || block?.opens_hook || "").replace(/\s+/g, " ").trim();
  const words = raw.split(" ").filter(Boolean);
  if (words.length >= 3) {
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
      camera: "RECAP flash of last episode's dated receipt or desk pad, object only, no people",
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
      camera: "insert of the dated receipt on marble, no people, only the paper",
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
  shots = growSpokenForSku(shots, budget);
  shots = growToWindow(shots, budget);
  shots = collapseDuplicateButtons(shots);

  const head = plan.scenes[0] ?? { location: "interior", time: "night", characters: [] };
  // Injected shots (wide, insert, recap) carry no origin; they take the scene of the nearest planned shot.
  let lastOrigin = shots.find((shot) => shot.origin_scene != null)?.origin_scene ?? 0;
  for (const shot of shots) {
    if (shot.origin_scene == null) shot.origin_scene = lastOrigin;
    else lastOrigin = shot.origin_scene;
  }
  const grouped = groupEditorialScenes(shots);
  return {
    ...plan,
    hook: plan.hook?.trim() || shots[0]?.dialogue || "The turn is already happening.",
    cliffhanger: plan.cliffhanger?.trim() || "The door opens on the unpaid question.",
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
