import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ageFromNote,
  castAppearance,
  fillAppearance,
  heritagePalettes,
  inferGenderFromText,
} from "../drama-engine/craft/appearance.ts";
import { appearanceDescription } from "../engine/pipeline/wardrobe.ts";

/**
 * Every generated actor was stored with the same appearance profile, so the
 * only per-character words in the image prompt were the name and a line about
 * the plot. The model filled the gap with its own house face and every
 * generated character came back as the same person.
 */
describe("cast appearance", () => {
  it("gives two characters visibly different faces", () => {
    const one = castAppearance({ name: "Serafina Castellane", gender: "woman" });
    const two = castAppearance({ name: "Nova Keel", gender: "woman" });
    expect(one.ethnicity_notes).not.toBe(two.ethnicity_notes);
    expect(one.hair).not.toBe(two.hair);
    expect(one.face).not.toBe(two.face);
  });

  it("spreads a cast of six across heritages, hair and builds", () => {
    const cast = ["Serafina Castellane", "Tazio Castellane", "Dominik Reyes", "Nova Keel", "Silas Renner", "Odette Vance"];
    const looks = cast.map((name) => castAppearance({ name, gender: "woman" }));
    // A shared surname must not hand two characters the same face.
    expect(new Set(looks.map((look) => look.ethnicity_notes)).size).toBeGreaterThan(3);
    expect(new Set(looks.map((look) => look.hair)).size).toBeGreaterThan(3);
    expect(new Set(looks.map((look) => look.face)).size).toBe(6);
  });

  it("keeps one character's face stable, so a retry is the same person", () => {
    const first = castAppearance({ name: "Dominik Reyes", gender: "man" });
    const again = castAppearance({ name: "  dominik reyes  ", gender: "man" });
    expect(again).toEqual(first);
  });

  it("names real features, not the placeholder the old profile stored", () => {
    const look = castAppearance({ name: "Dominik Reyes", gender: "man" });
    expect(look.face).not.toBe("adult man");
    expect(look.body).not.toBe("adult man");
    expect(look.hair).not.toBe("");
    expect(look.ethnicity_notes).not.toBe("");
  });

  it("takes the age from the brief instead of contradicting it", () => {
    expect(ageFromNote("Adult woman, 40s, the family counsel")).toBe("40s");
    expect(ageFromNote("junior attorney, 29, drafted the prenup")).toBe("29-year-old");
    expect(ageFromNote("a man in his late thirties")).toBe("late thirties");
    expect(ageFromNote("the courier at the gate")).toBeNull();
    expect(castAppearance({ name: "Odette Vance", gender: "woman", note: "Adult woman, 40s, counsel" }).age_look).toBe(
      "40s woman",
    );
  });

  it("leaves hair and build unsexed when the role has no gender", () => {
    const look = castAppearance({ name: "Ash Mercer", gender: null });
    expect(look.age_look).toMatch(/adult$/);
    expect(look.hair).not.toBe("");
    expect(look.body).not.toBe("");
  });

  it("reads gender from the words the slate uses", () => {
    expect(inferGenderFromText("her uncle and the family's don")).toBeNull();
    expect(inferGenderFromText("the heiress who runs her family's money")).toBe("woman");
    expect(inferGenderFromText("adult man, the courier at the gate")).toBe("man");
    expect(inferGenderFromText("the contract on the table")).toBeNull();
  });

  it("only gives a heritage the hair and eye colours that go with it", () => {
    const names = ["Ava", "Liam", "Mia", "Noah", "Zara", "Kai", "Elena", "Marco", "Yuki", "Omar", "Freya", "Diego"];
    for (const gender of ["man", "woman"] as const) {
      for (const first of names) {
        const look = castAppearance({ name: `${first} Vane`, gender });
        const palette = heritagePalettes(look.ethnicity_notes);
        expect(palette, look.ethnicity_notes).not.toBeNull();
        // Blond hair and blue eyes must not land on deep brown skin.
        const colour = palette!.hair.some((item) => look.hair.startsWith(item));
        const greying = /^(salt-and-pepper|greying dark|silver-streaked black) /.test(look.hair);
        expect(colour || greying, `${look.ethnicity_notes} / ${look.hair}`).toBe(true);
        expect(palette!.eyes.some((item) => look.face.includes(item)), `${look.ethnicity_notes} / ${look.face}`).toBe(true);
      }
    }
  });

  it("greys the hair only once a character is old enough for it", () => {
    const young = castAppearance({ name: "Ada Vane", gender: "woman", note: "29, junior attorney" });
    expect(young.hair).not.toMatch(/salt-and-pepper|greying|silver-streaked/);
    const older = castAppearance({ name: "Ada Vane", gender: "woman", note: "50s, the family counsel" });
    expect(older.age_look).toBe("50s woman");
  });

  it("does not overrule a face the buyer described themselves", () => {
    const cast = castAppearance({ name: "Ada Vane", gender: "woman" });
    const filled = fillAppearance("Tall redhead, sharp jaw, pale freckled skin", cast);
    expect(filled.hair).toBe("");
    expect(filled.face).toBe("");
    expect(filled.body).toBe("");
    expect(filled.ethnicity_notes).toBe("");
  });

  it("fills in the traits a thin note leaves out", () => {
    const cast = castAppearance({ name: "Ada Vane", gender: "woman" });
    const filled = fillAppearance("a lawyer who signs the papers", cast);
    expect(filled.hair).toBe(cast.hair);
    expect(filled.ethnicity_notes).toBe(cast.ethnicity_notes);
    expect(filled.body).toBe(cast.body);
  });
});

describe("appearance description", () => {
  it("carries skin tone into the prompt", () => {
    const look = castAppearance({ name: "Dominik Reyes", gender: "man" });
    const text = appearanceDescription({ description: "Dominik Reyes", ...look });
    expect(text).toContain(look.ethnicity_notes);
    expect(text).toContain(look.hair);
    expect(text).toContain(look.body);
  });

  it("no longer reduces a character to the name and the word adult", () => {
    const look = castAppearance({ name: "Serafina Castellane", gender: "woman" });
    const text = appearanceDescription({ description: "Serafina Castellane", ...look, default_wardrobe: "" });
    expect(text.length).toBeGreaterThan(80);
    expect(text).not.toBe("Serafina Castellane. adult. adult woman. adult woman");
  });
});

describe("still prompt", () => {
  const source = readFileSync(new URL("../engine/ai/images.ts", import.meta.url), "utf8");

  it("tells the model the listed features are binding", () => {
    expect(source).toMatch(/IDENTITY IS BINDING/);
    expect(source).toMatch(/Do not substitute a default handsome or pretty model face/);
    expect(source).toMatch(/recognisably different people/);
  });

  it("says where a tight crop ends, on both the text and anchored paths", () => {
    expect(source).toMatch(/BOTTOM EDGE OF THE PICTURE CUTS ACROSS THE CHEST/);
    expect(source).toMatch(/Not a fashion or lookbook mid-shot/);
    expect((source.match(/\$\{TIGHT_CROP_RULE\}/g) ?? []).length).toBe(2);
  });
});

describe("cast look gate", () => {
  const rubric = readFileSync(new URL("../engine/ai/vision.ts", import.meta.url), "utf8");

  it("refuses a mid-shot as close, whatever the eyes read like", () => {
    expect(rubric).toMatch(/a third of the frame height/);
    expect(rubric).toMatch(/reaches the waist, the hips/);
  });

  it("refuses an open jacket over bare skin as modest", () => {
    expect(rubric).toMatch(/covered to the collarbone/);
    expect(rubric).toMatch(/over bare skin with no garment beneath/);
    const modesty = readFileSync(new URL("../engine/ai/modesty.ts", import.meta.url), "utf8");
    expect(modesty).toMatch(/never over bare skin/);
  });
});

describe("generated actor creation", () => {
  it("writes cast traits instead of the placeholder profile", () => {
    const casting = readFileSync(new URL("../../supabase/functions/_shared/casting.ts", import.meta.url), "utf8");
    expect(casting).toMatch(/castAppearance\(/);
    expect(casting).not.toMatch(/face: `adult \$\{gender\}`/);
    expect(casting).not.toMatch(/age_look: "adult"/);
  });

  it("casts traits for a hand-made generated actor but not for a photo likeness", () => {
    const api = readFileSync(new URL("../../supabase/functions/api/index.ts", import.meta.url), "utf8");
    expect(api).toMatch(/fillAppearance\(/);
    expect(api).toMatch(/seed\s*\n?\s*\?\s*\{ default_wardrobe: "", description \}/);
  });
});
