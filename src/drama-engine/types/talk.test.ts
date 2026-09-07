import { describe, expect, it } from "vitest";
import { acceptPolishedTalk, isRefusalLoop, soundsStaged, talkProblems } from "./talk.ts";

describe("short-drama talk", () => {
  it("flags lawyer English and hospital loops", () => {
    expect(soundsStaged("It is not something that I can do.")).toBe(true);
    expect(soundsStaged("Do not bring me to the hospital.")).toBe(true);
    expect(soundsStaged("Don't bring me to the hospital.")).toBe(true);
    expect(soundsStaged("I can't go there.")).toBe(false);
    expect(soundsStaged("If they see me I'm done.")).toBe(false);
    expect(
      isRefusalLoop(
        [
          "ELENA: Don't take me to the hospital.",
          "ALYSSA: I have to take you.",
          "ELENA: Don't take me to the hospital.",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(talkProblems("ELENA: It is not something that I can do.").length).toBeGreaterThan(0);
    expect(talkProblems("ELENA: I can't go there.\nALYSSA: You're burning up.")).toEqual([]);
    expect(
      isRefusalLoop(
        ["ELENA: I can't believe you.", "ALYSSA: Don't start.", "ELENA: I have to think."].join("\n"),
      ),
    ).toBe(false);
  });

  it("rejects a polish rewrite that thins cues or makes talk worse", () => {
    const clean = [
      "ELENA: I can't go there.",
      "ALYSSA: You're burning up.",
      "ELENA: Not that place.",
      "ALYSSA: Then say where.",
      "ELENA: If they see me I'm done.",
    ].join("\n");
    const dirtier = [
      "ELENA: Don't take me to the hospital.",
      "ALYSSA: I have to take you.",
      "ELENA: No, don't.",
      "ALYSSA: There are reasons I cannot go.",
      "ELENA: Do not bring me.",
    ].join("\n");
    const thin = "ELENA: I can't go there.\nALYSSA: You're burning up.";
    expect(acceptPolishedTalk(clean, dirtier)).toBe(false);
    expect(acceptPolishedTalk(clean, thin)).toBe(false);
    expect(acceptPolishedTalk(clean, clean)).toBe(true);
    expect(acceptPolishedTalk(thin, "ELENA: I can't go there.\nALYSSA: You're burning up.\nELENA: Not that place.")).toBe(
      true,
    );
  });
});
