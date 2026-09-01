import type { Shot } from "../../engine/domain.ts";
import { HEAD_HANDLE_SECONDS as GENERATION_HEAD_HANDLE_SECONDS } from "../../engine/config/models.ts";
import { OVERLAP } from "../types/audio.ts";
import type { AudioRole, TransitionType } from "../types/editorial.ts";
import { isObjectInsert } from "../types/editorial.ts";
import { classifyEditorialShot, groupEditorialScenes, type EditorialSceneKind } from "./scene-groups.ts";

export function pickTransition(prev: Shot, next: Shot): TransitionType {
  const prevBlock = prev.shot_data.block_index;
  const nextBlock = next.shot_data.block_index;
  if (prevBlock != null && nextBlock != null && prevBlock !== nextBlock) return "cut";
  const nextRole = audioRole(next);
  const prevRole = audioRole(prev);
  if (nextRole === "offscreen" || next.shot_data.function === "listener_hold") return "lcut";
  if (isSilentHold(next) && prevRole === "onscreen" && hasSpokenLine(prev)) return "lcut";
  if (next.shot_data.function === "button_cu") return "hold";
  return "cut";
}

/** 12 frames at 30fps — inside the 8–16 frame reaction hold. */
export const REACTION_HOLD_SECONDS = 12 / 30;
export const JCUT_LEAD_SECONDS = OVERLAP.interruptLeadMs.max / 1000;
export const LCUT_HOLD_SECONDS = OVERLAP.lcutHoldMs.max / 1000;
export const HOOK_PICTURE_MAX_SECONDS = 2.2;
export const HOOK_JCUT_LEAD_SECONDS = 0.85;
export const SILENT_HOLD_MAX_SECONDS = 2.5;
export const SILENT_HOLD_HARD_MAX_SECONDS = 3;
export const SPOKEN_PICTURE_MAX_SECONDS = 6.5;
export const INSERT_PICTURE_MAX_SECONDS = 4;
export const BUTTON_PICTURE_MAX_SECONDS = 5;
export const BUTTON_FREEZE_SECONDS = 1.2;
/** Same handle finalizeShotDuration adds to I2V, so in-point matches the mouth. */
export const HEAD_HANDLE_SECONDS = GENERATION_HEAD_HANDLE_SECONDS;

export type EditClip = {
  shot: Shot;
  scene_index: number;
  scene_kind: EditorialSceneKind;
  transition_in: TransitionType;
  picture_start_seconds: number;
  picture_duration_seconds: number;
  hold_tail_seconds: number;
  audio_start_seconds: number | null;
  audio_tail_seconds: number;
  spike: boolean;
};

function audioRole(shot: Shot): AudioRole {
  return shot.shot_data.audio_role ?? (shot.shot_data.dialogue ? "onscreen" : "silent");
}

function hasSpokenLine(shot: Shot): boolean {
  return Boolean(shot.shot_data.dialogue);
}

function isSilentHold(shot: Shot): boolean {
  if (shot.shot_data.function === "button_cu") return false;
  if (isObjectInsert(shot.shot_data)) return false;
  if (hasSpokenLine(shot)) return false;
  const role = audioRole(shot);
  return (
    role === "silent" ||
    shot.shot_data.type === "reaction" ||
    shot.shot_data.function === "listener_hold" ||
    shot.shot_data.function === "reaction"
  );
}

function isSpike(shot: Shot, kind: EditorialSceneKind): boolean {
  if (kind === "evidence") return true;
  const fn = shot.shot_data.function;
  return fn === "insert_evidence" || fn === "phone_ui" || fn === "slap_peak";
}

export function editorialPictureSeconds(shot: Shot, available?: number | null): number {
  const planned = Math.max(0.4, shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds);
  const playable = available && available > 0 ? available : planned;
  const license = shot.shot_data.silence_license;
  const fn = shot.shot_data.function;
  const kind = classifyEditorialShot(shot);

  if (fn === "hook_cu") {
    return Math.min(HOOK_PICTURE_MAX_SECONDS, playable);
  }
  if (fn === "button_cu" || kind === "button") {
    return Math.min(BUTTON_PICTURE_MAX_SECONDS, playable);
  }
  if (
    (license === "post_nuke" || license === "post_slap") &&
    !hasSpokenLine(shot) &&
    isSilentHold(shot)
  ) {
    return Math.min(SILENT_HOLD_HARD_MAX_SECONDS, Math.max(1.5, Math.min(playable, planned)));
  }
  if (isSilentHold(shot)) {
    return Math.min(SILENT_HOLD_MAX_SECONDS, playable);
  }
  if (kind === "evidence" || isObjectInsert(shot.shot_data)) {
    return Math.min(INSERT_PICTURE_MAX_SECONDS, playable);
  }
  if (hasSpokenLine(shot)) {
    return Math.min(SPOKEN_PICTURE_MAX_SECONDS, playable);
  }
  return Math.min(SILENT_HOLD_MAX_SECONDS, playable);
}

export function buildEditTimeline(
  shots: Shot[],
  durationFor?: (shot: Shot) => number | null | undefined,
): { clips: EditClip[]; duration_seconds: number } {
  const scenes = groupEditorialScenes(shots);
  const clips: EditClip[] = [];
  let picture = 0;

  for (const scene of scenes) {
    for (const [index, shot] of scene.shots.entries()) {
      const prev = clips.at(-1);
      const sameScene = prev?.scene_index === scene.index;
      const blockChanged =
        prev != null &&
        prev.shot.shot_data.block_index != null &&
        shot.shot_data.block_index != null &&
        prev.shot.shot_data.block_index !== shot.shot_data.block_index;
      let transition: TransitionType = !prev || blockChanged ? "cut" : sameScene ? pickTransition(prev.shot, shot) : "cut";
      const spoken = hasSpokenLine(shot);
      if (prev && spoken && audioRole(shot) === "onscreen") {
        transition = transition === "lcut" ? "lcut" : "cut";
      }
      const button = shot.shot_data.function === "button_cu" || scene.kind === "button";
      const chapter = shot.shot_data.function === "block_button";
      const holdTail = button
        ? BUTTON_FREEZE_SECONDS
        : chapter
          ? 0.35
          : transition === "hold"
            ? REACTION_HOLD_SECONDS
            : 0;
      if (transition === "lcut" && prev) {
        const overlap = Math.min(LCUT_HOLD_SECONDS, Math.max(0, prev.picture_duration_seconds - 0.4));
        prev.picture_duration_seconds = Math.max(0.4, prev.picture_duration_seconds - overlap);
        prev.audio_tail_seconds = overlap;
        picture -= overlap;
      }
      const audioStart: number | null = spoken ? picture : null;
      const capped = Math.max(0.4, editorialPictureSeconds(shot, durationFor?.(shot)));
      const moving = button ? Math.max(0.4, capped - holdTail) : capped;
      clips.push({
        shot,
        scene_index: scene.index,
        scene_kind: scene.kind,
        transition_in: transition,
        picture_start_seconds: picture,
        picture_duration_seconds: moving + holdTail,
        hold_tail_seconds: holdTail,
        audio_start_seconds: audioStart,
        audio_tail_seconds: 0,
        spike: isSpike(shot, scene.kind),
      });
      picture += moving + holdTail;
    }
  }

  return { clips, duration_seconds: picture };
}

export function sceneListFromClips(clips: EditClip[]): Array<{
  index: number;
  kind: EditorialSceneKind;
  shot_ids: string[];
  transition_in: TransitionType;
}> {
  const scenes = groupEditorialScenes(clips.map((clip) => clip.shot));
  return scenes.map((scene) => ({
    index: scene.index,
    kind: scene.kind,
    shot_ids: scene.shots.map((shot) => shot.id),
    transition_in: clips.find((clip) => clip.scene_index === scene.index)?.transition_in ?? "cut",
  }));
}

export { classifyEditorialShot };
