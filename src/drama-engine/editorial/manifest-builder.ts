import type { RenderManifest, RenderTransitionStyle, Shot } from "../../engine/domain.ts";
import { isSceneTake, type AudioRole } from "../types/editorial.ts";
import type { GenreId } from "../types/genre.ts";
import { musicMoodForScene, nextBedMood, type BedMood } from "../craft/music/mood.ts";
import { groupEditorialScenes } from "./scene-groups.ts";
import { buildEditTimeline, HEAD_HANDLE_SECONDS, pickTransition } from "./timeline.ts";

export type ManifestBuildInput = {
  episode_id: string;
  shots: Shot[];
  assetIdFor: (shot: Shot) => string;
  /** Playable seconds of the selected take (already net of any settle trim). */
  durationFor?: (shot: Shot) => number | null | undefined;
  genre?: GenreId | null;
  /** Scene metadata by shot, used for the mood map. */
  sceneFor?: (shot: Shot) => { location?: string | null; time?: string | null } | null | undefined;
  /** On-screen intro label for a character ("Night delivery driver"); null skips the label. */
  labelFor?: (name: string) => string | null | undefined;
};

/** Everyone a clip pictures, for first-appearance labels. */
function picturedNames(shot: Shot): string[] {
  const present = shot.shot_data.blocking?.present ?? [];
  if (present.length) return present;
  const names = [shot.shot_data.speaker_on_camera, shot.shot_data.speaker].filter((row): row is string => Boolean(row));
  return [...new Set(names)];
}

function audioRole(shot: Shot): AudioRole {
  return shot.shot_data.audio_role ?? (shot.shot_data.dialogue ? "onscreen" : "silent");
}

export { pickTransition };

/**
 * Short-drama joins are hard cuts. Never a white flash — in a dark room it
 * reads like a camera going off in the viewer's face. If a fade is ever
 * used, it is a few frames of black, not white.
 */
export const HANDOFF_CUT_SECONDS = 0.1;
/** Few-frame black only. Never emit fadewhite. */
export const HANDOFF_BLACK_SECONDS = 3 / 30;

export function handoffStyleFor(_shot?: Shot): { transition_style: RenderTransitionStyle; transition_seconds: number } {
  return { transition_style: "cut", transition_seconds: HANDOFF_CUT_SECONDS };
}

/** Silent clips only. Spoken takes keep every frame through the last word. */
export const CLIP_TAIL_TRIM_SECONDS = 0.5;
/** Hard cut to a 2s end card after the last shot. */
export const END_CARD_SECONDS = 2;

/**
 * Picture in-point for a take. Measured settle wins: it is the first frame
 * where the I2V still has finished morphing into the scene. Without a
 * measurement, native/hook takes start at 0 and TTS takes keep the generation
 * head handle so the in-point lands on the mouth.
 */
export function pictureInPointFor(shot: Shot): number {
  const settle = shot.shot_data.take_analysis?.settle_in_seconds;
  // A measured take starts where its measurement says, including at 0.
  if (isSceneTake(shot.shot_data)) return 0;
  if (settle != null) return Number(Math.max(0, settle).toFixed(2));
  if (shot.shot_data.function === "hook_cu" || shot.shot_data.heard_audio === "native") return 0;
  return HEAD_HANDLE_SECONDS;
}

export function buildRenderManifest(input: ManifestBuildInput): RenderManifest {
  const { clips } = buildEditTimeline(input.shots, input.durationFor);
  const scenes = groupEditorialScenes(input.shots);

  // One bed per editorial scene, chosen from craft and never repeated back-to-back.
  const moodByScene = new Map<number, BedMood>();
  let previous: BedMood | null = null;
  for (const scene of scenes) {
    const first = scene.shots[0];
    const meta = first ? input.sceneFor?.(first) : null;
    const preferred = musicMoodForScene({
      genre: input.genre,
      sceneKind: scene.kind,
      emotions: scene.shots.map((shot) => shot.shot_data.emotion),
      location: meta?.location,
      time: meta?.time,
    });
    const mood = nextBedMood(preferred, previous);
    moodByScene.set(scene.index, mood);
    previous = mood;
  }

  const introduced = new Set<string>();
  return {
    version: 1,
    episode_id: input.episode_id,
    shots: clips.map((clip) => {
      const introLabels = input.labelFor
        ? picturedNames(clip.shot).flatMap((name) => {
            const key = name.trim().toLowerCase().split(/\s+/)[0] ?? "";
            if (!key || introduced.has(key)) return [];
            introduced.add(key);
            const role = input.labelFor!(name);
            return role ? [`${name.trim().toUpperCase()} — ${role}`] : [];
          })
        : [];
      const spoken = Boolean(clip.shot.shot_data.dialogue);
      const tail = spoken ? 0 : CLIP_TAIL_TRIM_SECONDS;
      const trimmed = Math.max(0.4, clip.picture_duration_seconds - clip.hold_tail_seconds - tail);
      const handle = pictureInPointFor(clip.shot);
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
        audio_slip_seconds: clip.shot.shot_data.take_analysis?.audio_slip_seconds ?? 0,
        audio_skip_seconds: isSceneTake(clip.shot.shot_data) ? 0 : clip.shot.shot_data.take_analysis?.audio_skip_seconds,
        scene_index: clip.scene_index,
        scene_kind: clip.scene_kind,
        transition_in: clip.transition_in,
        spike: clip.spike,
        block_index: clip.shot.shot_data.block_index,
        sting:
          clip.shot.shot_data.function !== "hook_cu" &&
          (clip.shot.shot_data.function === "block_button" ||
            clip.shot.shot_data.function === "button_cu" ||
            Boolean(clip.shot.shot_data.comic_sting)),
        heard_audio: clip.shot.shot_data.heard_audio,
        music_mood: moodByScene.get(clip.scene_index) ?? "thriller",
        sfx: clip.shot.shot_data.sfx ?? (clip.spike ? "impact" : null),
        speaker: clip.shot.shot_data.speaker,
        scene_script: clip.shot.shot_data.scene_script ?? null,
        ...(clip.transition_in === "fade" ? handoffStyleFor(clip.shot) : {}),
        ...(introLabels.length ? { intro_labels: introLabels } : {}),
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
