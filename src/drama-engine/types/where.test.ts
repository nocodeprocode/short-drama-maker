import { describe, expect, it } from "vitest";
import {
  hasNeonIris,
  humanMotifs,
  stripIrisPhrases,
  stripPowerLanguage,
  whereProblems,
  wherePromptClause,
  WHERE_RULES,
} from "./where.ts";

describe("WHERE — power is one beat, not a look", () => {
  it("allows one licensed tell and blocks a gold-eye on every take", () => {
    expect(WHERE_RULES).toMatch(/real room/);
    expect(WHERE_RULES).toMatch(/one beat/);
    expect(
      whereProblems([
        { script: "NYLA: I opened it.\nROMAN: (eyes flash gold, one beat) Sit down." },
        { script: "NYLA: Then fire me.", camera: "gold-eyes ECU" },
        { script: "ROMAN: Forty-eight thousand.", emotion: "gold-eye flash" },
      ]).map((hit) => hit.kind),
    ).toEqual(expect.arrayContaining(["tell_spam", "unlicensed_look"]));
    expect(
      whereProblems([{ script: "NYLA: I opened it.\nROMAN: (eyes flash gold, one beat) Sit down." }, { script: "NYLA: Then fire me." }]),
    ).toEqual([]);
    expect(whereProblems([{ camera: "snout, fur, body changing" }])[0]?.kind).toBe("creature");
    expect(humanMotifs(["gold-eyes ECU", "black envelope", "low growl off-screen", "brass lamp"])).toEqual([
      "black envelope",
      "brass lamp",
    ]);
    expect(stripPowerLanguage("pale green eyes that can flash gold for one beat")).toMatch(/pale green eyes/);
    expect(stripPowerLanguage("pale green eyes that can flash gold for one beat")).not.toMatch(/flash/);
    expect(wherePromptClause("ROMAN: Sit down.")).toMatch(/no licensed power beat/);
    expect(wherePromptClause("ROMAN: (eyes flash gold, one beat) Sit down.")).toMatch(/one licensed power beat/);
  });

  it("keeps a striking iris from rendering as a light source", () => {
    expect(WHERE_RULES).toMatch(/HUMAN EYES/);
    expect(WHERE_RULES).toMatch(/never emits light/);
    expect(WHERE_RULES).toMatch(/darker with the face/);
    // A vivid iris written into the look is the same defect as a gold flash.
    expect(whereProblems([{ camera: "luminous green eyes in the dark" }])[0]?.kind).toBe("unlicensed_look");
    expect(stripPowerLanguage("pale green eyes that seem to glow")).toMatch(/pale green eyes/);
    expect(stripPowerLanguage("pale green eyes that seem to glow")).not.toMatch(/glow/);
  });

  it("treats a jewel iris as a power tell nobody wrote", () => {
    expect(hasNeonIris("pale green eyes, sharp jaw")).toBe(true);
    expect(hasNeonIris("piercing blue eyes")).toBe(true);
    expect(hasNeonIris("bright amber eyes")).toBe(true);
    expect(hasNeonIris("deep grey-green eyes, sharp jaw")).toBe(false);
    expect(hasNeonIris("dark almond eyes, high straight brows")).toBe(false);
    expect(hasNeonIris("deep-set dark brown eyes")).toBe(false);
  });

  it("keeps eye colour out of a video prompt and leaves the rest of the face", () => {
    expect(stripIrisPhrases("pale green eyes, sharp jaw, straight nose, pale-gold skin")).toBe(
      "sharp jaw, straight nose, pale-gold skin",
    );
    expect(stripIrisPhrases("dark almond eyes with a wet shine, high brows, sharp cheekbones")).toBe(
      "high brows, sharp cheekbones",
    );
    expect(stripIrisPhrases("deep grey-green eyes, dark lashes, sharp jaw")).toBe("dark lashes, sharp jaw");
    expect(stripIrisPhrases("sharp jaw, full mouth")).toBe("sharp jaw, full mouth");
    expect(stripIrisPhrases("")).toBe("");
  });
});
