import { describe, expect, it } from "vitest";
import { cameraIsObjectPlate } from "../../drama-engine/types/editorial.ts";
import {
  cutEligible,
  orderIdentityRefs,
  resolveIdentityRefPolicy,
  shouldFailoverModel,
  shouldRegenTake,
} from "./identity-refs.ts";

describe("identity refs", () => {
  it("sends face CU first on face_first and wardrobe first on wardrobe_first", () => {
    const face = { url: "https://mem/cu", kind: "cu" };
    const wardrobe = { url: "https://mem/look", kind: "default_wardrobe" };
    const a = orderIdentityRefs({ policy: "face_first", face, wardrobe });
    expect(a.urls[0]).toBe(face.url);
    expect(a.urls[1]).toBe(wardrobe.url);
    expect(a.first_frame_kind).toBe("cu");
    const b = orderIdentityRefs({ policy: "wardrobe_first", face, wardrobe });
    expect(b.urls[0]).toBe(wardrobe.url);
    expect(b.urls[1]).toBe(face.url);
    expect(b.first_frame_kind).toBe("wardrobe");
  });

  it("drops wardrobe and location extras on face_only", () => {
    const face = { url: "https://mem/cu", kind: "cu" };
    const wardrobe = { url: "https://mem/look", kind: "default_wardrobe" };
    const only = orderIdentityRefs({ policy: "face_only", face, wardrobe });
    expect(only.urls).toEqual([face.url]);
    expect(only.first_frame_kind).toBe("cu");
    expect(resolveIdentityRefPolicy("face_only")).toBe("face_only");
    expect(cameraIsObjectPlate("Tight single on Mara's hand sliding unlabeled paper")).toBe(true);
    expect(cameraIsObjectPlate("Tight single on Mara's face, scar above the brow")).toBe(false);
  });

  it("never invents a face still for an empty insert pair", () => {
    const empty = orderIdentityRefs({ policy: "wardrobe_first", face: null, wardrobe: null });
    expect(empty.urls).toEqual([]);
  });

  it("gates the pro cut on drift, internal cuts, and duration disasters", () => {
    expect(cutEligible([])).toBe(true);
    expect(cutEligible(["duration_mismatch"])).toBe(true);
    expect(cutEligible(["identity_drift"])).toBe(false);
    expect(cutEligible(["internal_cut"])).toBe(true);
    expect(cutEligible(["duration_disaster"])).toBe(false);
    expect(shouldRegenTake({ status: "needs_review", reasons: ["identity_drift"] })).toBe(true);
    expect(shouldRegenTake({ status: "needs_review", reasons: ["internal_cut"], model: "alibaba/wan-3.0" })).toBe(
      false,
    );
    expect(shouldRegenTake({ status: "needs_review", reasons: ["identity_drift"], alreadyRegenerated: true })).toBe(
      false,
    );
    expect(shouldFailoverModel("alibaba/wan-3.0", ["internal_cut"])).toBe(false);
    expect(shouldFailoverModel("alibaba/wan-3.0", ["identity_drift"])).toBe(false);
    expect(shouldFailoverModel("bytedance/seedance-2.0-mini", ["identity_drift"])).toBe(true);
  });
});
