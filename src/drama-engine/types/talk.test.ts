import { describe, expect, it } from "vitest";
import { acceptPolishedTalk, keepPlanAfterPolishFailure, isRefusalLoop, soundsStaged, talkProblems, TALK_RULES } from "./talk.ts";

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
    expect(soundsStaged("This constitutes a payment.")).toBe(true);
    expect(soundsStaged("Then this document constitutes a payment toward the outstanding balance.")).toBe(true);
    expect(soundsStaged("This is the envelope.")).toBe(true);
    expect(soundsStaged("This is pack law.")).toBe(true);
    expect(soundsStaged("I am informing you.")).toBe(true);
    expect(soundsStaged("The aforementioned writ is open.")).toBe(true);
    expect(soundsStaged("That was never a letter.")).toBe(true);
    expect(soundsStaged("Signed by my hand.")).toBe(true);
    expect(soundsStaged("You broke a seal that wasn't yours.")).toBe(true);
    expect(soundsStaged("A claim.")).toBe(true);
    expect(soundsStaged("The black one, red wax.")).toBe(true);
    expect(soundsStaged("I hereby claim you.")).toBe(true);
    expect(soundsStaged("Under pack law you stay.")).toBe(true);
    expect(soundsStaged("Are you trying to bribe me?")).toBe(false);
    expect(soundsStaged("You opened it.")).toBe(false);
    expect(soundsStaged("Don't play dumb.")).toBe(false);
    expect(talkProblems("NYLA: Are you trying to bribe me?\nROMAN: Sleep better calling it that.")).toEqual([]);
    expect(TALK_RULES).toMatch(/Same mouth does not wait/);
    expect(TALK_RULES).toMatch(/Never name-drop someone the viewer has not met/);
    expect(TALK_RULES).toMatch(/DROP-IN/);
    expect(TALK_RULES).toMatch(/my second/);
    expect(
      talkProblems(
        [
          "NYLA: I opened your envelope.",
          "NYLA: The black one, red wax.",
          "ROMAN: That was never a letter.",
          "ROMAN: A claim.",
          "ROMAN: Signed by my hand.",
        ].join("\n"),
      ).length,
    ).toBeGreaterThan(0);
    expect(talkProblems("ROMAN: This constitutes a claim.\nNYLA: Say that again.").length).toBeGreaterThan(0);
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

  it("rethrows polish failure when the current scripts are staged", () => {
    const dirty = {
      scenes: [
        {
          shots: [
            {
              edit_mode: "scene_take" as const,
              scene_script: "ELENA: It is not something that I can do.\nALYSSA: Then say it.",
            },
          ],
        },
      ],
    };
    expect(() => keepPlanAfterPolishFailure(dirty, new Error("polish down"))).toThrow(/staged/);
    const clean = {
      scenes: [
        {
          shots: [
            {
              edit_mode: "scene_take" as const,
              scene_script: "ELENA: I can't go there.\nALYSSA: You're burning up.",
            },
          ],
        },
      ],
    };
    expect(keepPlanAfterPolishFailure(clean, new Error("polish down"))).toBe(clean);
  });
});
