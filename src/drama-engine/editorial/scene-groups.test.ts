import { describe, expect, it } from "vitest";
import type { Shot } from "../../engine/domain.ts";
import { groupEditorialScenes } from "./scene-groups.ts";
import { buildRenderManifest, pickTransition } from "./manifest-builder.ts";
import { buildEditTimeline } from "./timeline.ts";

function shot(partial: Partial<Shot["shot_data"]> & { id: string; position?: number }): Shot {
  return {
    id: partial.id,
    scene_id: "sc",
    position: partial.position ?? 1,
    selected_generation_id: null,
    status: "complete",
    shot_data: {
      type: "dialogue",
      speaker: "Mara",
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera: "cu",
      mouth_visibility_required: false,
      duration_hint_seconds: 4,
      duration_seconds: 4,
      dialogue_audio_asset_id: null,
      dialogue_alignment_asset_id: null,
      hero: false,
      ...partial,
    },
  };
}

describe("editorial scenes", () => {
  it("groups hook evidence, dialogue coverage, and a button", () => {
    const shots = [
      shot({ id: "h", function: "hook_cu", type: "broll", audio_role: "silent" }),
      shot({ id: "a", function: "accusation_cu", dialogue: "You knew.", audio_role: "onscreen" }),
      shot({ id: "r", function: "reaction", type: "reaction", audio_role: "silent" }),
      shot({ id: "p", function: "phone_ui", type: "broll", audio_role: "silent" }),
      shot({ id: "b", function: "button_cu", dialogue: "Whose name?", audio_role: "onscreen" }),
    ];
    const scenes = groupEditorialScenes(shots);
    expect(scenes.map((scene) => scene.kind)).toEqual(["evidence", "dialogue", "evidence", "button"]);
  });

  it("marks a listener hold as an L-cut and places audio on the picture timeline", () => {
    const prev = shot({
      id: "a",
      function: "accusation_cu",
      dialogue: "Three months.",
      audio_role: "onscreen",
    });
    const next = shot({
      id: "b",
      function: "listener_hold",
      type: "reaction",
      dialogue: "Stay.",
      audio_role: "offscreen",
    });
    expect(pickTransition(prev, next)).toBe("lcut");
    const { clips } = buildEditTimeline([prev, next]);
    expect(clips[1]?.transition_in).toBe("lcut");
    expect(clips[1]?.audio_start_seconds).toBe(clips[1]?.picture_start_seconds);
    expect(clips[0]!.picture_duration_seconds).toBeLessThan(4);
    expect(clips[1]!.picture_start_seconds).toBeLessThan(4);
    const manifest = buildRenderManifest({
      episode_id: "ep",
      shots: [prev, next],
      assetIdFor: (row) => row.id,
    });
    expect(manifest.scenes?.map((scene) => scene.kind)).toEqual(["dialogue"]);
    expect(manifest.shots[1]?.transition_in).toBe("lcut");
    expect(manifest.shots[1]?.audio_start_seconds).toBeGreaterThanOrEqual(0);
  });

  it("can build a manifest that excludes a stranger take", () => {
    const keep = shot({ id: "a", function: "accusation_cu", dialogue: "You knew.", audio_role: "onscreen" });
    const drop = shot({
      id: "x",
      function: "accusation_cu",
      dialogue: "Stay.",
      audio_role: "onscreen",
      identity_reject: true,
    });
    const playable = [keep, drop].filter((row) => !row.shot_data.identity_reject);
    const manifest = buildRenderManifest({
      episode_id: "ep",
      shots: playable,
      assetIdFor: (row) => `asset-${row.id}`,
    });
    expect(manifest.shots.map((row) => row.shot_id)).toEqual(["a"]);
    expect(manifest.shots[0]?.audio_start_seconds).toBe(manifest.shots[0]?.picture_start_seconds);
  });

  it("muxes onscreen speech to that take's picture clock", () => {
    const hook = shot({ id: "h", function: "hook_cu", type: "broll", audio_role: "silent" });
    const line = shot({ id: "a", function: "accusation_cu", dialogue: "You knew.", audio_role: "onscreen" });
    const { clips } = buildEditTimeline([hook, line]);
    const spokenManifest = buildRenderManifest({
      episode_id: "ep-handle",
      shots: [line],
      assetIdFor: (row) => row.id,
    });
    expect(spokenManifest.shots[0]?.in_point_seconds).toBe(0.35);
    const nativeLine = shot({
      id: "n",
      function: "accusation_cu",
      dialogue: "You knew.",
      audio_role: "onscreen",
      heard_audio: "native",
    });
    const nativeManifest = buildRenderManifest({
      episode_id: "ep-native",
      shots: [nativeLine],
      assetIdFor: (row) => row.id,
    });
    expect(nativeManifest.shots[0]?.in_point_seconds).toBe(0);
    expect(spokenManifest.shots[0]?.audio_start_seconds).toBe(spokenManifest.shots[0]?.picture_start_seconds);
    expect(clips[0]?.scene_kind).toBe("evidence");
    expect(clips[1]?.scene_kind).toBe("dialogue");
    expect(clips[1]?.transition_in).toBe("cut");
    expect(clips[1]?.audio_start_seconds).toBe(clips[1]?.picture_start_seconds);
    expect(clips[0]!.picture_duration_seconds).toBeLessThanOrEqual(2.2);
  });

  it("caps silent holds at 3s, hook at 3s, and the button at 5s", () => {
    const shots = [
      shot({
        id: "h",
        function: "hook_cu",
        type: "broll",
        audio_role: "silent",
        duration_hint_seconds: 5,
        duration_seconds: 5,
      }),
      shot({
        id: "a",
        function: "accusation_cu",
        dialogue: "You knew.",
        audio_role: "onscreen",
        duration_hint_seconds: 7,
        duration_seconds: 7,
      }),
      shot({
        id: "r",
        function: "reaction",
        type: "reaction",
        audio_role: "silent",
        duration_hint_seconds: 6,
        duration_seconds: 6,
      }),
      shot({
        id: "b",
        function: "button_cu",
        dialogue: "Then whose name?",
        audio_role: "onscreen",
        duration_hint_seconds: 7,
        duration_seconds: 7,
      }),
    ];
    expect(pickTransition(shots[1]!, shots[2]!)).toBe("lcut");
    const { clips } = buildEditTimeline(shots);
    expect(clips[0]!.picture_duration_seconds).toBeLessThanOrEqual(2.2);
    expect(clips[2]!.picture_duration_seconds).toBeLessThanOrEqual(3);
    expect(clips[2]!.transition_in).toBe("lcut");
    expect(clips[3]!.picture_duration_seconds).toBeLessThanOrEqual(5);
    expect(clips[3]!.hold_tail_seconds).toBeGreaterThan(0);
    const manifest = buildRenderManifest({
      episode_id: "ep",
      shots,
      assetIdFor: (row) => row.id,
    });
    const silent = manifest.shots[2]!;
    const silentPicture = silent.out_point_seconds - silent.in_point_seconds + (silent.hold_tail_seconds ?? 0);
    expect(silentPicture).toBeLessThanOrEqual(3);
  });

  it("does not crush a spoken line that was tagged post_nuke for a reaction pad", () => {
    const line = shot({
      id: "a",
      function: "accusation_cu",
      dialogue: "How many Tuesdays.",
      audio_role: "onscreen",
      silence_license: "post_nuke",
      duration_hint_seconds: 6,
      duration_seconds: 6,
    });
    const { clips } = buildEditTimeline([line], () => 7);
    expect(clips[0]!.picture_duration_seconds).toBeGreaterThan(3);
    expect(clips[0]!.picture_duration_seconds).toBeLessThanOrEqual(6.5);
  });
});
