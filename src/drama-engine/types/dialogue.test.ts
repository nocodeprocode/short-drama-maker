import { describe, expect, it } from "vitest";
import { clipCueToBreath, sceneTakesAreCopies, sceneTakesShareSpokenBeat, spokenTextFromSceneScript } from "./dialogue.ts";

describe("clipCueToBreath", () => {
  it("keeps a short cue and clips a wordy one without dropping the speaker tag", () => {
    expect(clipCueToBreath("SARAH: I can't go there.")).toBe("SARAH: I can't go there.");
    expect(clipCueToBreath("SARAH: (freezes) I can't go there.")).toBe("SARAH: (freezes) I can't go there.");
    expect(clipCueToBreath("SARAH: This is not something that I can do in this kitchen tonight after everything.")).toBe(
      "SARAH: This is not something that I can do in this kitchen tonight",
    );
    expect(clipCueToBreath("david: Don't.", 0)).toBe("david: Don't.");
    expect(["david: Don't.", "sarah: Three months.", "david: Look at me."].map((row) => clipCueToBreath(row))).toEqual([
      "david: Don't.",
      "sarah: Three months.",
      "david: Look at me.",
    ]);
  });
});

describe("sceneTakesShareSpokenBeat", () => {
  it("treats the same scene script as one beat", () => {
    const script = "Sarah: How long?\nDavid: Don't.";
    expect(sceneTakesShareSpokenBeat({ scene_script: script }, { scene_script: script })).toBe(true);
  });

  it("lets a take hand off on one echoed line, and calls two a replay", () => {
    // One repeated line at the seam is a handoff the boundary repair strips.
    expect(
      sceneTakesShareSpokenBeat(
        { scene_script: "Sarah: How long?\nDavid: Don't." },
        { scene_script: "Sarah: How long?\nDavid: Three months." },
      ),
    ).toBe(false);
    expect(
      sceneTakesShareSpokenBeat(
        { scene_script: "Sarah: How long?\nDavid: Don't." },
        { scene_script: "Sarah: How long?\nDavid: Don't ask me that." },
      ),
    ).toBe(true);
  });

  it("lets adjacent kitchen beats stay distinct when the spoken text is new", () => {
    expect(
      sceneTakesShareSpokenBeat(
        {
          scene_script:
            "MARA: Petra, where are the scissors — third drawer is stuck.\nPETRA: There's a pair in the second drawer, MARA — I moved them Tuesday.\nMARA: I found something else.",
        },
        {
          scene_script:
            "PETRA: That drawer's been locked since I started here. Eleven years, MARA — I never had a key for it.\nMARA: For Diana.\nPETRA: What does it say?\nMARA: It says Diana is the intended bride.",
        },
      ),
    ).toBe(false);
  });

  it("strips speaker cues from a scene script", () => {
    expect(spokenTextFromSceneScript("MARA: Stay.\nPETRA: [opens drawer] Second drawer.")).toBe("Stay. Second drawer.");
  });

  it("does not treat two short lines that share one word as copies", () => {
    expect(sceneTakesAreCopies({ dialogue: "Count 2." }, { dialogue: "Count 8." })).toBe(false);
  });
});
