import { describe, expect, it } from "vitest";
import type { Shot } from "../../engine/domain.ts";
import { groupEditorialScenes } from "./scene-groups.ts";
import { buildRenderManifest, handoffStyleFor, pickTransition } from "./manifest-builder.ts";
import { buildEditTimeline, speechNeedSeconds } from "./timeline.ts";

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

  it("keeps a spoken hook through the last word instead of capping at 2.2s", () => {
    const hook = shot({
      id: "h",
      function: "hook_cu",
      dialogue: "Where did you hear that name?",
      audio_role: "onscreen",
      duration_hint_seconds: 4,
      duration_seconds: 4,
    });
    expect(speechNeedSeconds(hook)).toBeGreaterThan(2.2);
    const { clips } = buildEditTimeline([hook]);
    expect(clips[0]!.picture_duration_seconds).toBeGreaterThan(2.2);
    const manifest = buildRenderManifest({
      episode_id: "ep-spoken-hook",
      shots: [hook],
      assetIdFor: (row) => row.id,
    });
    const row = manifest.shots[0]!;
    expect(row.out_point_seconds - row.in_point_seconds).toBeGreaterThan(2.2);
  });

  it("plays a scene take in full with no freeze tail", () => {
    const take = shot({
      id: "st",
      function: "button_cu",
      edit_mode: "scene_take",
      dialogue: "Then whose name is on it?",
      audio_role: "onscreen",
      heard_audio: "native",
      duration_hint_seconds: 15,
      duration_seconds: 15,
    });
    const { clips } = buildEditTimeline([take], () => 15.07);
    expect(clips[0]!.picture_duration_seconds).toBeCloseTo(15.07, 2);
    expect(clips[0]!.hold_tail_seconds).toBe(0);
    const manifest = buildRenderManifest({
      episode_id: "ep-scene-take",
      shots: [take],
      assetIdFor: (row) => row.id,
      durationFor: () => 15.07,
    });
    expect(manifest.shots[0]?.in_point_seconds).toBe(0);
    expect(manifest.shots[0]?.out_point_seconds).toBeCloseTo(15.07, 2);
  });

  it("fades between scene takes instead of a hard cut", () => {
    const first = shot({
      id: "st1",
      function: "hook_cu",
      edit_mode: "scene_take",
      dialogue: "Whose name is on that carrier?",
      scene_script: "MARA: Whose name is on that carrier?",
      audio_role: "onscreen",
      duration_hint_seconds: 14,
      duration_seconds: 14,
    });
    const second = shot({
      id: "st2",
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "COLE",
      dialogue: "Yours.",
      scene_script: "COLE: Yours.",
      audio_role: "onscreen",
      duration_hint_seconds: 14,
      duration_seconds: 14,
    });
    expect(pickTransition(first, second)).toBe("fade");
    const { clips } = buildEditTimeline([first, second]);
    expect(clips[1]?.transition_in).toBe("fade");
    const manifest = buildRenderManifest({
      episode_id: "ep-labels",
      shots: [first, second],
      assetIdFor: (row) => row.id,
      labelFor: (name) => (name.toUpperCase() === "MARA" ? "Night delivery driver" : name.toUpperCase() === "COLE" ? "Night clerk" : null),
    });
    expect(manifest.shots[0]?.intro_labels).toEqual(["MARA — Night delivery driver"]);
    expect(manifest.shots[1]?.intro_labels).toEqual(["COLE — Night clerk"]);
    expect(manifest.shots[1]?.transition_style).toBe("cut");
    expect(manifest.shots[1]?.transition_style).not.toBe("fadewhite");
    const button = shot({
      id: "st3",
      function: "button_cu",
      edit_mode: "scene_take",
      speaker: "COLE",
      dialogue: "Then whose name?",
      scene_script: "COLE: Then whose name?",
      audio_role: "onscreen",
      duration_hint_seconds: 14,
      duration_seconds: 14,
    });
    expect(handoffStyleFor(button).transition_style).toBe("cut");
    expect(handoffStyleFor(button).transition_style).not.toBe("fadewhite");
    const buttonManifest = buildRenderManifest({
      episode_id: "ep-no-flash",
      shots: [first, second, button],
      assetIdFor: (row) => row.id,
    });
    expect(buttonManifest.shots.every((row) => row.transition_style !== "fadewhite")).toBe(true);
    expect(buttonManifest.shots.at(-1)?.transition_style).toBe("cut");
  });

  it("does not tail-trim a spoken take", () => {
    const line = shot({
      id: "a",
      function: "accusation_cu",
      dialogue: "I signed Tuesday.",
      audio_role: "onscreen",
      duration_hint_seconds: 4,
      duration_seconds: 4,
    });
    const { clips } = buildEditTimeline([line]);
    const manifest = buildRenderManifest({
      episode_id: "ep-no-trim",
      shots: [line],
      assetIdFor: (row) => row.id,
    });
    const row = manifest.shots[0]!;
    expect(row.out_point_seconds - row.in_point_seconds).toBeCloseTo(clips[0]!.picture_duration_seconds, 2);
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
