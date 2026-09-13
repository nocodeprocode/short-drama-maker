import { describe, expect, it } from "vitest";
import {
  appearanceDescription,
  looksFromBible,
  preferredCuFace,
  preferredFaceId,
  seedStillForCu,
  stillAssetIds,
  stillKindLabel,
  wardrobeForScene,
} from "./wardrobe.ts";

describe("wardrobe", () => {
  it("maps story locations to a small look list", () => {
    expect(
      looksFromBible({
        locations: ["The archive office", "A gala ballroom", "Nadia's apartment kitchen"],
        default_wardrobe: "black blouse",
      }),
    ).toEqual(["everyday", "office", "formal", "home"]);
  });

  it("caps looks at four", () => {
    expect(
      looksFromBible({
        locations: ["office", "gala", "home kitchen", "city street", "rooftop park"],
      }).length,
    ).toBeLessThanOrEqual(4);
  });

  it("picks the office look for an archive-office scene", () => {
    expect(
      wardrobeForScene(
        { everyday: "e1", office: "o1", formal: "f1" },
        "The archive office — rows of shelved files",
      ),
    ).toBe("o1");
  });

  it("falls back to everyday when no location matches", () => {
    expect(wardrobeForScene({ everyday: "e1", formal: "f1" }, "A train platform")).toBe("e1");
  });

  it("orders face stills front-first", () => {
    expect(
      stillAssetIds({
        visual_reference_asset_ids: { profile: "p", front: "f", full_body: "b" },
        wardrobe_asset_ids: { office: "w" },
      }),
    ).toEqual(["f", "p", "b", "w"]);
    expect(preferredFaceId({ profile: "p", front: "f" })).toBe("f");
    expect(preferredCuFace({ full_body: "b", front: "f" })).toEqual({ id: "f", kind: "front" });
    expect(preferredCuFace({ full_body: "b" })).toBeNull();
    expect(seedStillForCu({ full_body: "b" })).toEqual({ id: "b", kind: "full_body" });
    expect(preferredCuFace({ cu: "c", front: "f", full_body: "b" })).toEqual({ id: "c", kind: "cu" });
  });

  it("labels looks and kinds", () => {
    expect(stillKindLabel("front")).toBe("Front");
    expect(stillKindLabel("look:office")).toBe("Office");
  });

  it("builds a packed character payload without crashing on an empty pack", () => {
    const visual = { visual_reference_asset_ids: {}, wardrobe_asset_ids: {} };
    expect(stillAssetIds(visual)).toEqual([]);
    expect(stillKindLabel("front")).toBe("Front");
  });

  it("joins appearance notes for image prompts", () => {
    expect(
      appearanceDescription({
        description: "Nadia's husband",
        hair: "dark cropped hair",
        default_wardrobe: "navy suit",
      }),
    ).toBe("Nadia's husband. dark cropped hair. navy suit");
  });

  it("never paints a power look into a still prompt", () => {
    const text = appearanceDescription({
      description: "Club owner",
      face: "pale green eyes that flash gold for one beat, sharp jaw",
      hair: "black swept back",
    });
    expect(text).toMatch(/pale green eyes/);
    expect(text).toMatch(/sharp jaw/);
    expect(text).not.toMatch(/flash|gold/i);
  });
});
