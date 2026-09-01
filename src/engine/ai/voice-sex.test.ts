import { describe, expect, it } from "vitest";
import { alignVoicePrompt, inferVoiceSex, voiceSexRepair } from "./voice-sex.ts";

describe("voice sex", () => {
  it("reads woman from a character description", () => {
    expect(inferVoiceSex("A 31-year-old woman who appears first only as a face in a photograph.")).toBe("female");
    expect(inferVoiceSex("Nadia's 34-year-old husband. He is charming in public.")).toBe("male");
  });

  it("prefixes a female prompt that forgot the sex", () => {
    expect(alignVoicePrompt("Soft, careful, slightly husky.", "Reem Saleh. A 31-year-old woman.")).toMatch(
      /Adult woman\. Female speaking voice/i,
    );
  });

  it("leaves an already-gendered prompt alone", () => {
    const prompt = "Adult woman. Female, late twenties, conversational.";
    expect(alignVoicePrompt(prompt, "A 27-year-old woman")).toBe(prompt);
  });

  it("is idempotent after the first alignment", () => {
    const first = alignVoicePrompt("Soft, careful, slightly husky.", "Reem Saleh. A 31-year-old woman.");
    expect(alignVoicePrompt(first, "Reem Saleh. A 31-year-old woman.")).toBe(first);
    expect(
      voiceSexRepair({
        locked: true,
        design_prompt: first,
        identityText: "Reem Saleh. A 31-year-old woman.",
      }).action,
    ).toBe("none");
  });

  it("aligns an unlocked prompt without unlocking or clearing pending work", () => {
    const repair = voiceSexRepair({
      locked: false,
      design_prompt: "Soft, careful, slightly husky.",
      identityText: "Reem Saleh. A 31-year-old woman.",
    });
    expect(repair.action).toBe("align_prompt");
    expect(repair.design_prompt).toMatch(/Adult woman/);
  });

  it("unlocks only when a locked voice is the wrong sex", () => {
    const repair = voiceSexRepair({
      locked: true,
      design_prompt: "Adult man. Male speaking voice. Soft, careful.",
      identityText: "Reem Saleh. A 31-year-old woman.",
    });
    expect(repair.action).toBe("unlock_wrong_sex");
    expect(repair.design_prompt).toMatch(/Adult woman/);
  });
});
