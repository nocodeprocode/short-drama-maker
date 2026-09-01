import type { RenderManifest, Shot } from "../../engine/domain.ts";
import type { AudioRole } from "../types/editorial.ts";
import { groupEditorialScenes } from "./scene-groups.ts";
import { buildEditTimeline, HEAD_HANDLE_SECONDS, pickTransition } from "./timeline.ts";

export type ManifestBuildInput = {
  episode_id: string;
  shots: Shot[];
  assetIdFor: (shot: Shot) => string;
  durationFor?: (shot: Shot) => number | null | undefined;
};

function audioRole(shot: Shot): AudioRole {
  return shot.shot_data.audio_role ?? (shot.shot_data.dialogue ? "onscreen" : "silent");
}

export { pickTransition };

export function buildRenderManifest(input: ManifestBuildInput): RenderManifest {
  const { clips } = buildEditTimeline(input.shots, input.durationFor);
  const scenes = groupEditorialScenes(input.shots);

  return {
    version: 1,
    episode_id: input.episode_id,
    shots: clips.map((clip) => {
      const trimmed = Math.max(0.4, clip.picture_duration_seconds - clip.hold_tail_seconds);
      const handle =
        clip.shot.shot_data.function === "hook_cu" || clip.shot.shot_data.heard_audio === "native"
          ? 0
          : HEAD_HANDLE_SECONDS;
      return {
        shot_id: clip.shot.id,
        asset_id: input.assetIdFor(clip.shot),
        in_point_seconds: handle,
        out_point_seconds: handle + trimmed,
        overlap_seconds: clip.transition_in === "cut" ? 0 : clip.audio_tail_seconds || clip.hold_tail_seconds,
        audio_role: audioRole(clip.shot),
        picture_start_seconds: clip.picture_start_seconds,
        audio_start_seconds: clip.audio_start_seconds,
        hold_tail_seconds: clip.hold_tail_seconds,
        scene_index: clip.scene_index,
        scene_kind: clip.scene_kind,
        transition_in: clip.transition_in,
        spike: clip.spike,
        block_index: clip.shot.shot_data.block_index,
        sting: clip.shot.shot_data.function === "block_button" || Boolean(clip.shot.shot_data.comic_sting),
        heard_audio: clip.shot.shot_data.heard_audio,
        music_mood: clip.scene_kind === "button" ? "tension" : "thriller",
        sfx: clip.shot.shot_data.sfx ?? (clip.spike ? "impact" : null),
        speaker: clip.shot.shot_data.speaker,
      };
    }),
    caption_asset_ids: input.shots
      .map((shot) => shot.shot_data.dialogue_alignment_asset_id)
      .filter((id): id is string => Boolean(id)),
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: clips.slice(0, -1).map((clip, index) => ({
      after_shot_id: clip.shot.id,
      type: clips[index + 1]!.transition_in,
      overlap_seconds: clips[index + 1]!.transition_in === "cut" ? 0 : clips[index + 1]!.hold_tail_seconds || 0.35,
    })),
    scenes: scenes.map((scene) => ({
      index: scene.index,
      kind: scene.kind,
      shot_ids: scene.shots.map((shot) => shot.id),
    })),
  };
}
