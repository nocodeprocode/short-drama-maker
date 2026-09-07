import type { Shot } from "../domain.ts";
import { isObjectInsert, isSceneTake } from "../../drama-engine/types/editorial.ts";

export const LAST_FRAME_KIND = "last_frame";

export function picturedForContinuity(shot: Pick<Shot, "shot_data">): string | null {
  const data = shot.shot_data;
  if (isObjectInsert(data)) return null;
  if (data.speaker_on_camera) return data.speaker_on_camera.trim().toLowerCase();
  if (data.audio_role === "offscreen" || data.function === "listener_hold") return null;
  return data.speaker?.trim().toLowerCase() ?? null;
}

export function framingForContinuity(shot: Pick<Shot, "shot_data">): string {
  const fn = shot.shot_data.function;
  if (fn === "reaction" || fn === "listener_hold") return "reaction";
  if (fn === "insert_evidence" || fn === "phone_ui") return "insert";
  return "mcu";
}

export function previousContinuityShot(input: {
  current: Shot;
  sceneShots: Shot[];
}): Shot | null {
  const pictured = picturedForContinuity(input.current);
  const framing = framingForContinuity(input.current);
  if (!pictured) return null;
  const earlier = input.sceneShots
    .filter((shot) => shot.position < input.current.position && shot.status === "complete")
    .sort((a, b) => b.position - a.position);
  return (
    earlier.find(
      (shot) => picturedForContinuity(shot) === pictured && framingForContinuity(shot) === framing,
    ) ?? null
  );
}

/** Previous completed scene-take in the episode — first frame of the next scene. */
export function previousSceneTake(input: {
  current: Shot;
  episodeShots: Shot[];
  locationOf?: (shot: Shot) => string | null;
}): Shot | null {
  const idx = input.episodeShots.findIndex((shot) => shot.id === input.current.id);
  const here = input.locationOf?.(input.current) ?? null;
  const earlier = (idx >= 0 ? input.episodeShots.slice(0, idx) : input.episodeShots.filter((shot) => shot.id !== input.current.id))
    .filter((shot) => shot.status === "complete" && isSceneTake(shot.shot_data))
    .filter((shot) => !input.locationOf || !here || input.locationOf(shot) === here);
  return (
    [...earlier].reverse().find((shot) => shot.shot_data.continuity?.last_frame_asset_id) ??
    earlier.at(-1) ??
    null
  );
}
