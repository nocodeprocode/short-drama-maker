import { describe, expect, it } from "vitest";
import type { Shot } from "../domain.ts";
import { buildVideoSubmitPayload, payloadContainsAudioUrl } from "./video.ts";

function dialogueShot(): Shot {
  return {
    id: "sh",
    scene_id: "sc",
    position: 1,
    selected_generation_id: null,
    status: "audio_ready",
    shot_data: {
      type: "dialogue",
      speaker: "Mara",
      dialogue: "You knew about this for three months.",
      emotion: "controlled",
      delivery: "quiet",
      pace: "slow",
      camera: "medium close-up",
      mouth_visibility_required: true,
      duration_hint_seconds: 4,
      duration_seconds: 4,
      dialogue_audio_asset_id: "audio",
      dialogue_alignment_asset_id: "align",
      hero: false,
    },
  };
}

describe("OpenRouter video payload", () => {
  it("refuses dialogue without a fetchable audio URL", () => {
    expect(() =>
      buildVideoSubmitPayload({
        shot: dialogueShot(),
        prompt: "speak",
        visual_reference_urls: ["https://media.example/still.png"],
        audio_reference_url: null,
        duration_seconds: 4,
        model: "alibaba/wan-3.0",
        privacy_profile: "standard",
        callback_url: "https://example.invalid/callback",
      }),
    ).toThrow(/Dialogue video requires a real dialogue-audio URL/);
  });

  it("puts the dialogue audio URL on the wire and omits ZDR", () => {
    const audio = "https://media.example/o/dialogue.mp3?exp=1&sig=abc";
    const payload = buildVideoSubmitPayload({
      shot: dialogueShot(),
      prompt: "speak",
      visual_reference_urls: ["https://media.example/still.png"],
      audio_reference_url: audio,
      duration_seconds: 4,
      model: "alibaba/wan-3.0",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
    });
    expect(payloadContainsAudioUrl(payload, audio)).toBe(true);
    expect(JSON.stringify(payload.provider)).not.toContain('"zdr"');
    expect(payload.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://media.example/still.png" },
        frame_type: "first_frame",
      },
    ]);
    expect(payload.generate_audio).toBe(true);
    expect(payload.resolution).toBe("720p");
  });

  it("sends Seedance coverage singles as reference-to-video, never first-frame plus faces", () => {
    const face = "https://media.example/sarah-front.png";
    const payload = buildVideoSubmitPayload({
      shot: dialogueShot(),
      prompt: "COVERAGE SINGLE @Image1 is SARAH",
      visual_reference_urls: [face],
      audio_reference_url: null,
      duration_seconds: 5,
      model: "bytedance/seedance-2.5",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
    });
    expect(payload.frame_images).toBeUndefined();
    expect(payload.input_references).toEqual([{ type: "image_url", image_url: { url: face } }]);
    expect(payload.generate_audio).toBe(true);
  });

  it("lets Seedance scene takes generate native speech without a TTS URL", () => {
    const payload = buildVideoSubmitPayload({
      shot: {
        ...dialogueShot(),
        shot_data: {
          ...dialogueShot().shot_data,
          edit_mode: "scene_take",
          function: "scene_take",
          scene_script: "Mara: How long?\nCole: Don't.",
          dialogue_audio_asset_id: null,
          dialogue_alignment_asset_id: null,
        },
      },
      prompt: "one continuous scene",
      visual_reference_urls: ["https://media.example/still.png"],
      audio_reference_url: null,
      duration_seconds: 15,
      model: "bytedance/seedance-2.5",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
    });
    expect(payload.generate_audio).toBe(true);
    expect(payloadContainsAudioUrl(payload, "dialogue.mp3")).toBe(false);
  });

  it("sends Seedance scene takes as reference-to-video, never first-frame plus faces", () => {
    const faces = [
      "https://media.example/mara-front.png",
      "https://media.example/cole-front.png",
      "https://media.example/last-frame.png",
    ];
    const payload = buildVideoSubmitPayload({
      shot: {
        ...dialogueShot(),
        shot_data: {
          ...dialogueShot().shot_data,
          edit_mode: "scene_take",
          function: "scene_take",
          scene_script: "Mara: How long?\nCole: Don't.",
          dialogue_audio_asset_id: null,
          dialogue_alignment_asset_id: null,
        },
      },
      prompt: "one continuous scene @Image1 is MARA",
      visual_reference_urls: faces,
      audio_reference_url: null,
      duration_seconds: 15,
      model: "bytedance/seedance-2.5",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
      seed: 42,
    });
    expect(payload.frame_images).toBeUndefined();
    expect(payload.input_references).toEqual([
      { type: "image_url", image_url: { url: faces[0] } },
      { type: "image_url", image_url: { url: faces[1] } },
      { type: "image_url", image_url: { url: faces[2] } },
    ]);
    expect(payload.seed).toBe(42);
  });

  it("clamps Seedance seeds to signed int32", () => {
    const payload = buildVideoSubmitPayload({
      shot: {
        ...dialogueShot(),
        shot_data: {
          ...dialogueShot().shot_data,
          edit_mode: "scene_take",
          function: "scene_take",
        },
      },
      prompt: "lock",
      visual_reference_urls: ["https://media.example/mara-front.png"],
      audio_reference_url: null,
      duration_seconds: 15,
      model: "bytedance/seedance-2.5",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
      seed: 3_000_000_000,
    });
    expect(payload.seed).toBeLessThanOrEqual(2147483647);
    expect(payload.seed).toBeGreaterThanOrEqual(0);
  });

  it("never attaches a previous-take video on a Seedance scene take", () => {
    const payload = buildVideoSubmitPayload({
      shot: {
        ...dialogueShot(),
        shot_data: {
          ...dialogueShot().shot_data,
          edit_mode: "scene_take",
          function: "scene_take",
          scene_script: "Mara: How long?\nCole: Don't.",
          dialogue_audio_asset_id: null,
          dialogue_alignment_asset_id: null,
        },
      },
      prompt: "@Image1 is MARA @Image2 is COLE",
      visual_reference_urls: [
        "https://media.example/mara-front.png",
        "https://media.example/mara-side.png",
        "https://media.example/kitchen.png",
      ],
      video_reference_url: "https://media.example/prev.mp4",
      audio_reference_url: null,
      duration_seconds: 15,
      model: "bytedance/seedance-2.5",
      privacy_profile: "standard",
      callback_url: "https://example.invalid/callback",
    });
    expect(payload.frame_images).toBeUndefined();
    expect(payload.input_references).toEqual([
      { type: "image_url", image_url: { url: "https://media.example/mara-front.png" } },
      { type: "image_url", image_url: { url: "https://media.example/mara-side.png" } },
      { type: "image_url", image_url: { url: "https://media.example/kitchen.png" } },
    ]);
    expect(JSON.stringify(payload.input_references)).not.toMatch(/video_url|prev\.mp4/);
  });
});
