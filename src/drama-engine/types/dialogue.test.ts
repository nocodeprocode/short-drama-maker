import { describe, expect, it } from "vitest";
import { clipCueToBreath, collapseSameSpeakerBreaths, dropOpeningEcho, identifiesNameInBreath, rewriteUnseenNames, sceneTakesAreCopies, sceneTakesShareSpokenBeat, spokenTextFromSceneScript, unseenNamesInScript } from "./dialogue.ts";

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

describe("unseen names", () => {
  it("blocks a namedrop the viewer has not met, and allows role or an on-camera face", () => {
    expect(identifiesNameInBreath("Your sister Juno still gets it?", "Juno")).toBe(true);
    expect(identifiesNameInBreath("Juno, my sister, still gets it?", "Juno")).toBe(true);
    expect(identifiesNameInBreath("Juno still gets her surgery?", "Juno")).toBe(false);
    expect(identifiesNameInBreath("The night nurse Mira is here.", "Mira")).toBe(true);
    expect(identifiesNameInBreath("Mira spiked again.", "Mira")).toBe(false);
    expect(identifiesNameInBreath("My intern Kira stays.", "Kira")).toBe(true);
    expect(identifiesNameInBreath("Kira stays.", "Kira")).toBe(false);
    expect(
      unseenNamesInScript({
        script: "NYLA: Juno still gets her surgery?",
        onCamera: ["NYLA", "ROMAN"],
        metThisEpisode: ["NYLA", "ROMAN"],
        namedCast: ["Nyla", "Roman", "Juno"],
      }).map((row) => row.name),
    ).toEqual(["Juno"]);
    expect(
      unseenNamesInScript({
        script: "NYLA: My sister still gets her surgery?",
        onCamera: ["NYLA", "ROMAN"],
        namedCast: ["Nyla", "Roman", "Juno"],
      }),
    ).toEqual([]);
    expect(
      unseenNamesInScript({
        script: "NYLA: Your sister Juno still gets it?",
        onCamera: ["NYLA", "ROMAN"],
        namedCast: ["Nyla", "Roman", "Juno"],
      }),
    ).toEqual([]);
    expect(
      unseenNamesInScript({
        script: "JUNO: I'm still here.\nNYLA: Juno, sit up.",
        onCamera: ["NYLA", "JUNO"],
        namedCast: ["Nyla", "Juno"],
      }),
    ).toEqual([]);
    expect(
      rewriteUnseenNames("NYLA: Juno still gets her surgery?", [{ name: "Juno", line: "Juno still gets her surgery?" }], () => "my sister"),
    ).toBe("NYLA: my sister still gets her surgery?");
  });
});

describe("collapseSameSpeakerBreaths", () => {
  it("joins two short Nyla lines into one breath and leaves a stunned beat alone", () => {
    expect(
      collapseSameSpeakerBreaths([
        "NYLA: I opened your envelope.",
        "NYLA: It was already cracked, so don't start.",
        "ROMAN: Sit down.",
      ]),
    ).toEqual(["NYLA: I opened your envelope — It was already cracked, so don't start.", "ROMAN: Sit down."]);
    expect(collapseSameSpeakerBreaths(["NYLA: I opened it.", "NYLA: (goes still) So you're buying me."])).toEqual([
      "NYLA: I opened it.",
      "NYLA: (goes still) So you're buying me.",
    ]);
  });
});

describe("dropOpeningEcho", () => {
  it("drops Finish the sentence when it opens the next take", () => {
    const prev = ["NYLA: You opened it.", "ROMAN: So what.", "NYLA: Finish the sentence."].join("\n");
    const next = [
      "NYLA: Finish the sentence.",
      "ROMAN: You're mine.",
      "NYLA: Say that again.",
      "ROMAN: Not here.",
      "NYLA: Then where.",
    ].join("\n");
    expect(dropOpeningEcho(prev, next)).toBe(
      ["ROMAN: You're mine.", "NYLA: Say that again.", "ROMAN: Not here.", "NYLA: Then where."].join("\n"),
    );
    expect(dropOpeningEcho("NYLA: Finish the sentence.", "ROMAN: Finish the sentence.")).toBe("ROMAN: Finish the sentence.");
    expect(dropOpeningEcho("NYLA: Finish the sentence.", "ROMAN: You're mine.\nNYLA: Say it.")).toBe(
      "ROMAN: You're mine.\nNYLA: Say it.",
    );
  });
});
