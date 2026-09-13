import { describe, expect, it } from "vitest";
import { lastSpokenLine, videoContextBlock } from "./video-context.ts";

describe("video context pack", () => {
  it("quotes the last clip and does not dump the whole bible", () => {
    const text = videoContextBlock({
      title: "The Wolf Boss Hired His Mate",
      logline: "The courier he hired opened a mate-claim envelope.",
      episodeNumber: 1,
      hook: "She drops the opened envelope on his desk.",
      conflict: "He hires her to keep her.",
      genreMotifs: ["mate claim", "hidden alpha"],
      characters: [
        {
          name: "Nyla Rhee",
          description: "Night courier paying her sister's hospital bill.",
          appearance: { ethnicity_notes: "warm-olive", hair: "long black", default_wardrobe: "zipped black courier jacket" },
          relationships: { Roman: "the boss who just hired her" },
        },
        {
          name: "Roman Hale",
          description: "Club owner and hidden Alpha.",
          appearance: { ethnicity_notes: "pale-gold", hair: "black swept back" },
        },
      ],
      priorTakes: [
        {
          scene_script: "NYLA: I opened your envelope — it was already cracked, so don't start.\nROMAN: Sit down.",
          blocking: { present: ["NYLA", "ROMAN"], prop: "broken envelope" },
          blocking_note: "Nyla camera-left at the desk, Roman standing camera-right.",
        },
      ],
      thisTake: { index: 1, present: ["NYLA", "ROMAN"], prop: "broken envelope" },
    });
    expect(text).toMatch(/^CONTEXT\./);
    expect(text).toMatch(/SERIES: The Wolf Boss Hired His Mate/);
    expect(text).toMatch(/THIS EPISODE \(episode 1\)/);
    expect(text).toMatch(/ALREADY SAID THIS EPISODE: "Sit down\."/);
    expect(text).toMatch(/LAST CLIP: they just said "Sit down\."/);
    expect(text).toMatch(/Do not say that last line again/);
    expect(text).toMatch(/CAST IN FRAME: Nyla/);
    expect(text).toMatch(/warm-olive/);
    expect(text).toMatch(/THIS CLIP is take 2/);
    expect(text).not.toMatch(/gold-eyes|flash gold/i);
    expect(text).not.toMatch(/hospital bill of forty-eight/);
    expect(lastSpokenLine("NYLA: One.\nROMAN: (rises) Two.")).toBe("Two.");
  });

  it("names the previous episode when this is not episode 1", () => {
    const text = videoContextBlock({
      title: "The Wolf Boss",
      episodeNumber: 2,
      hook: "The woman across the river arrives.",
      priorEpisode: { number: 1, cliffhanger: "The date inside is twenty-six years old." },
      thisTake: { index: 0, present: ["NYLA", "ROMAN"] },
    });
    expect(text).toMatch(/BEFORE THIS EPISODE: episode 1 ended: The date inside/);
    expect(text).toMatch(/The viewer may be new/);
  });
});
