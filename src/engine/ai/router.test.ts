import { describe, expect, it } from "vitest";
import type { Shot, VideoRoute } from "../domain.ts";
import { failoverRoute, router } from "./router.ts";

function shot(partial: Partial<Shot["shot_data"]>): Shot {
  return {
    id: "sh",
    scene_id: "sc",
    position: 1,
    selected_generation_id: null,
    status: "audio_ready",
    shot_data: {
      type: "dialogue",
      speaker: "sarah",
      dialogue: "How long?",
      emotion: "anger",
      delivery: null,
      pace: null,
      camera: "close_up",
      mouth_visibility_required: true,
      duration_hint_seconds: 4,
      duration_seconds: 4,
      dialogue_audio_asset_id: "a",
      dialogue_alignment_asset_id: "b",
      hero: false,
      ...partial,
    },
  };
}

describe("video router", () => {
  it("hides model lists and picks by shot role", () => {
    const dialogue = router.selectVideoRoute(shot({ type: "dialogue" }), "standard", "auto");
    expect(dialogue.route.model).toBe("bytedance/seedance-2.5");
    expect(dialogue.reason).toMatch(/Seedance 2\.5|verified audio-conditioned dialogue|audio-capable route/);
    // A hero-flagged spoken line still goes to the audio-capable route, never a silent model.
    const heroLine = router.selectVideoRoute(shot({ type: "hero", hero: true, dialogue: "Then whose name is on it?", audio_role: "onscreen" }), "standard", "auto");
    expect(heroLine.route.model).toBe("bytedance/seedance-2.5");

    const reaction = router.selectVideoRoute(
      shot({ type: "reaction", dialogue: null, speaker: null, duration_seconds: 4 }),
      "standard",
      "auto",
    );
    expect(reaction.route.model).toBe("bytedance/seedance-2.5");

    const hero = router.selectVideoRoute(
      shot({
        type: "hero",
        hero: true,
        dialogue: null,
        speaker: null,
        duration_seconds: 6,
      }),
      "standard",
      "auto",
    );
    expect(hero.route.model).toBe("bytedance/seedance-2.5");

    const longDialogue = router.selectVideoRoute(
      shot({ type: "dialogue", duration_seconds: 20 }),
      "standard",
      "auto",
    );
    expect(longDialogue.route.model).toBe("bytedance/seedance-2.5");
    expect(longDialogue.route.max_duration_seconds).toBe(15);

    const insert = router.selectVideoRoute(
      shot({
        type: "broll",
        function: "insert_evidence",
        audio_role: "silent",
        dialogue: null,
        speaker: null,
        camera: "insert of the dated paper, object only",
        duration_seconds: 4,
      }),
      "standard",
      "auto",
    );
    expect(insert.route.model).toBe("bytedance/seedance-2.0-mini");

    const offscreen = router.selectVideoRoute(
      shot({
        type: "reaction",
        audio_role: "offscreen",
        function: "listener_hold",
        dialogue: "Stay.",
        speaker: "david",
        duration_seconds: 5,
      }),
      "standard",
      "auto",
    );
    expect(offscreen.route.model).toBe("bytedance/seedance-2.5");
    expect(offscreen.reason).toMatch(/offscreen|economy/i);

    const prev = process.env.DRAMA_CU_MODEL;
    process.env.DRAMA_CU_MODEL = "alibaba/wan-3.0";
    try {
      const silent = router.selectVideoRoute(
        shot({
          type: "reaction",
          function: "reaction",
          audio_role: "silent",
          dialogue: null,
          speaker: null,
          duration_seconds: 4,
        }),
        "standard",
        "auto",
      );
      expect(silent.route.model).toBe("bytedance/seedance-2.5");
    } finally {
      if (prev === undefined) delete process.env.DRAMA_CU_MODEL;
      else process.env.DRAMA_CU_MODEL = prev;
    }
  });

  it("failovers Wan to Mini after Seedance 2.5 lost the identity bake-off", () => {
    const wan: VideoRoute = {
      model: "alibaba/wan-3.0",
      provider: "openrouter",
      role: "dialogue_default",
      min_duration_seconds: 2,
      max_duration_seconds: 30,
      aspect_ratios: ["9:16"],
      audio_conditioning_verified: true,
      region_documented: false,
      strict_privacy_allowed: false,
    };
    expect(failoverRoute(shot({}), wan).model).toBe("bytedance/seedance-2.0-mini");
  });

  it("routes a scene take to Seedance 2.5", () => {
    const scene = router.selectVideoRoute(
      shot({
        type: "dialogue",
        edit_mode: "scene_take",
        function: "scene_take",
        scene_script: "Mara: How long?\nCole: Don't.",
        duration_seconds: 15,
      }),
      "standard",
      "auto",
    );
    expect(scene.route.model).toBe("bytedance/seedance-2.5");
    expect(scene.reason).toMatch(/scene take/i);
  });

  it("keeps Pro on Seedance 2.5 and routes every Catalog shot to mini", () => {
    const spoken = shot({ type: "dialogue", audio_role: "onscreen" });
    expect(router.selectVideoRoute(spoken, "standard", "auto").route.model).toBe("bytedance/seedance-2.5");
    expect(router.selectVideoRoute(spoken, "standard", "economy").route.model).toBe("bytedance/seedance-2.5");
    expect(router.selectVideoRoute(spoken, "standard", "economy", "catalog").route.model).toBe(
      "bytedance/seedance-2.0-mini",
    );
    expect(router.selectVideoRoute(spoken, "standard", "auto", "catalog").route.model).toBe(
      "bytedance/seedance-2.0-mini",
    );
    const scene = router.selectVideoRoute(
      shot({
        type: "dialogue",
        edit_mode: "scene_take",
        function: "scene_take",
        scene_script: "Mara: How long?\nCole: Don't.",
        duration_seconds: 15,
      }),
      "standard",
      "auto",
      "catalog",
    );
    expect(scene.route.model).toBe("bytedance/seedance-2.0-mini");
    expect(scene.reason).toMatch(/catalog/i);
  });

  it("does not upgrade Catalog failover to Seedance 2.5", () => {
    const mini: VideoRoute = {
      model: "bytedance/seedance-2.0-mini",
      provider: "openrouter",
      role: "economy_default",
      min_duration_seconds: 4,
      max_duration_seconds: 15,
      aspect_ratios: ["9:16"],
      audio_conditioning_verified: false,
      region_documented: false,
      strict_privacy_allowed: false,
    };
    expect(failoverRoute(shot({}), mini).model).toBe("bytedance/seedance-2.5");
    expect(failoverRoute(shot({}), mini, "catalog").model).toBe("bytedance/seedance-2.0");
    expect(failoverRoute(shot({}), mini, "catalog").model).not.toBe("bytedance/seedance-2.5");
  });

  it("does not expose an unprovable strict privacy route", () => {
    expect(() => router.selectVideoRoute(shot({}), "strict" as never, "auto")).toThrow(
      /STRICT privacy is not shipped/,
    );
  });
});
