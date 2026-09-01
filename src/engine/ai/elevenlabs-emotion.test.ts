import { describe, expect, it } from "vitest";
import { emotionAudioTag, performDialogue } from "./elevenlabs.ts";

describe("ElevenLabs emotion performance", () => {
  it("tags a break/cry line for v3 and raises style", () => {
    expect(emotionAudioTag("break", "cry")).toBe("[crying]");
    const performed = performDialogue({
      text: "I kept every Tuesday.",
      emotion: "cry",
      delivery: "break",
    });
    expect(performed.text).toMatch(/^\[crying\]/);
    expect(performed.model).toBe("eleven_v3");
    expect(performed.voice_settings.style).toBeGreaterThan(0.4);
  });

  it("tags a shout and a whisper", () => {
    expect(emotionAudioTag("hot", "shout")).toBe("[shouts]");
    expect(emotionAudioTag("listening", "whisper")).toBe("[whispers]");
  });
});
