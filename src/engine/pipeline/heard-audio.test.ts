import { describe, expect, it } from "vitest";
import { chooseHeardLane, heardDelaySeconds, heardFileSkipSeconds } from "./heard-audio.ts";

describe("heard lane", () => {
  it("keeps native Wan audio when STT matches the line", async () => {
    await expect(
      chooseHeardLane({
        dialogue: "I did not write the paper.",
        audioRole: "onscreen",
        hasNativeAudio: true,
        nativeTranscript: "I did not write the paper",
      }),
    ).resolves.toBe("native");
  });

  it("keeps native on an audio-conditioned take even when STT misses", async () => {
    await expect(
      chooseHeardLane({
        dialogue: "I did not write the paper.",
        audioRole: "onscreen",
        hasNativeAudio: true,
        nativeTranscript: "the trees are loud tonight",
        audioConditioned: true,
      }),
    ).resolves.toBe("native");
  });

  it("keeps Seedance scene-take speech even when STT misses the hook line", async () => {
    await expect(
      chooseHeardLane({
        dialogue: "Petra, where are the scissors?",
        audioRole: "onscreen",
        hasNativeAudio: true,
        nativeTranscript: "Petra, where are the scissors? Third drawer is stuck. There's a pair in the second drawer.",
        sceneTake: true,
      }),
    ).resolves.toBe("native");
  });

  it("does not mux TTS over a take that was timed to missing native", async () => {
    await expect(
      chooseHeardLane({
        dialogue: "Then say who signed Tuesday.",
        audioRole: "onscreen",
        hasNativeAudio: false,
        audioConditioned: true,
      }),
    ).resolves.toBe("silent");
  });

  it("never uses listener lips for offscreen speech", async () => {
    await expect(
      chooseHeardLane({
        dialogue: "Stay.",
        audioRole: "offscreen",
        hasNativeAudio: true,
        nativeTranscript: "Stay.",
      }),
    ).resolves.toBe("tts");
  });

  it("never J-cuts onscreen speech before the picture", () => {
    expect(
      heardDelaySeconds({
        pictureStartSeconds: 9.2,
        audioStartSeconds: 8.4,
        audioRole: "onscreen",
      }),
    ).toBe(9.2);
  });

  it("pads native audio that leads the mouth by 2s instead of trimming both", () => {
    expect(
      heardDelaySeconds({
        pictureStartSeconds: 4,
        audioStartSeconds: 4,
        audioRole: "onscreen",
        visemePadSeconds: 1.92,
      }),
    ).toBeCloseTo(5.92);
  });

  it("trims native by the same in-point as picture", () => {
    expect(heardFileSkipSeconds({ lane: "native", inPointSeconds: 0.35 })).toBeCloseTo(0.35);
    expect(heardFileSkipSeconds({ lane: "native", inPointSeconds: 1.8 })).toBeCloseTo(1.8);
    expect(heardFileSkipSeconds({ lane: "tts", inPointSeconds: 0.35, leadingSilenceSeconds: 0 })).toBe(0);
  });
});
