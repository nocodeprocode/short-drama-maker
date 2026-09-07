import { describe, expect, it } from "vitest";
import {
  blockingFramingFor,
  blockingStillKey,
  selectShotRefs,
  shouldUseBlockingStill,
} from "./blocking-still.ts";
import { inferPropKind, propKey } from "./prop-bible.ts";
import { framingForContinuity, picturedForContinuity, previousContinuityShot, previousSceneTake } from "./last-frame.ts";
import type { Shot } from "../domain.ts";

function shot(partial: Partial<Shot["shot_data"]> & { id?: string; position?: number; status?: Shot["status"] }): Shot {
  return {
    id: partial.id ?? "s1",
    scene_id: "sc",
    position: partial.position ?? 1,
    selected_generation_id: null,
    status: partial.status ?? "complete",
    shot_data: {
      type: "dialogue",
      speaker: "Mara",
      dialogue: "You knew.",
      emotion: null,
      delivery: null,
      pace: null,
      camera: "close-up",
      mouth_visibility_required: true,
      duration_hint_seconds: 3,
      duration_seconds: 3,
      dialogue_audio_asset_id: null,
      dialogue_alignment_asset_id: null,
      hero: false,
      function: "accusation_cu",
      ...partial,
    },
  };
}

describe("blocking still refs", () => {
  it("keys character x location x framing and prefers last-frame then blocking then face", () => {
    expect(blockingStillKey("c1", "Corner Office", "cu")).toBe("c1::corner office::cu");
    expect(blockingFramingFor("listener_hold")).toBe("reaction");
    expect(blockingFramingFor("accusation_cu")).toBe("mcu");
    expect(blockingFramingFor("hook_cu")).toBe("mcu");
    expect(shouldUseBlockingStill({ function: "accusation_cu", type: "dialogue", dialogue: "You knew." })).toBe(true);
    expect(shouldUseBlockingStill({ function: "insert_evidence", type: "broll", dialogue: null })).toBe(false);
    const refs = selectShotRefs({
      lastFrameUrl: "https://mem/last",
      lastFrameId: "last",
      blockingUrl: "https://mem/block",
      blockingId: "block",
      faceUrl: "https://mem/face",
      faceId: "face",
      faceKind: "cu",
    });
    expect(refs.urls[0]).toBe("https://mem/last");
    expect(refs.urls[1]).toBe("https://mem/face");
    expect(refs.first_frame_asset_id).toBe("last");
    const bothFaces = selectShotRefs({
      lastFrameUrl: "https://mem/last",
      lastFrameId: "last",
      faceUrls: ["https://mem/mara", "https://mem/cole"],
    });
    expect(bothFaces.urls).toEqual(["https://mem/last", "https://mem/mara", "https://mem/cole"]);
    const identityFirst = selectShotRefs({
      lastFrameUrl: "https://mem/last",
      lastFrameId: "last",
      faceUrls: ["https://mem/mara", "https://mem/cole"],
      faceId: "mara",
      faceKind: "front",
      identityFirst: true,
    });
    expect(identityFirst.urls).toEqual(["https://mem/mara", "https://mem/cole", "https://mem/last"]);
    expect(identityFirst.first_frame_kind).toBe("face");
    const faceOnly = selectShotRefs({ faceUrl: "https://mem/face", faceId: "face", faceKind: "cu" });
    expect(faceOnly.urls).toEqual(["https://mem/face"]);
  });
});

describe("prop bible", () => {
  it("reuses letter/phone/contract/watch from camera language", () => {
    expect(inferPropKind("insert of the dated letter")).toBe("letter");
    expect(inferPropKind("insert of a phone face-down")).toBe("phone");
    expect(inferPropKind("insert of the unsigned contract")).toBe("contract");
    expect(inferPropKind("macro of the watch")).toBe("watch");
    expect(inferPropKind("closed wolf-dog carrier on the counter")).toBe("carrier");
    expect(propKey("letter")).toBe("prop:letter");
  });
});

describe("last-frame continuity", () => {
  it("finds the previous complete take of the same face and framing", () => {
    const prev = shot({ id: "a", position: 1, function: "accusation_cu", status: "complete" });
    const other = shot({ id: "b", position: 2, speaker: "Eli", function: "reaction", speaker_on_camera: "Eli", dialogue: null, status: "complete" });
    const current = shot({ id: "c", position: 3, function: "accusation_cu", status: "queued" });
    expect(picturedForContinuity(prev)).toBe("mara");
    expect(framingForContinuity(prev)).toBe("mcu");
    expect(previousContinuityShot({ current, sceneShots: [prev, other, current] })?.id).toBe("a");
  });

  it("welds the previous completed scene take in the same room only", () => {
    const kitchen = shot({
      id: "k1",
      position: 1,
      status: "complete",
      edit_mode: "scene_take",
      function: "scene_take",
      scene_script: "Mara: Stay.",
    });
    kitchen.shot_data.continuity = { kind: "weld", last_frame_asset_id: "frame-k" };
    const lobby = shot({
      id: "l1",
      position: 2,
      status: "complete",
      edit_mode: "scene_take",
      function: "scene_take",
      scene_script: "Eli: Here.",
    });
    lobby.shot_data.continuity = { kind: "weld", last_frame_asset_id: "frame-l" };
    const kitchen2 = shot({
      id: "k2",
      position: 3,
      status: "queued",
      edit_mode: "scene_take",
      function: "scene_take",
      scene_script: "Mara: Again.",
    });
    const loc = (row: Shot) => (row.id.startsWith("k") ? "kitchen" : "lobby");
    expect(previousSceneTake({ current: kitchen2, episodeShots: [kitchen, lobby, kitchen2], locationOf: loc })?.id).toBe("k1");
  });
});
