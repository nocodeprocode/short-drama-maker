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
});
