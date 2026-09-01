import { describe, expect, it } from "vitest";
import { PlanShapeError, validateBibleShape, validateBlockScenesShape, validatePlanShape } from "./plan-schema.ts";

const shot = { type: "dialogue", speaker: "Mara", dialogue: "Look at Tuesday.", camera: "tight single", duration_hint_seconds: 4 };

describe("plan shape validation", () => {
  it("accepts a well-formed plan and rejects the shapes that used to explode later", () => {
    expect(() => validatePlanShape({ title: "Ep", scenes: [{ location: "kitchen", time: "night", characters: ["Mara"], shots: [shot] }] })).not.toThrow();
    expect(() => validatePlanShape({ title: "Ep", scenes: [] })).toThrow(PlanShapeError);
    expect(() => validatePlanShape({ title: "Ep", scenes: [{ location: "kitchen", characters: [], shots: [] }] })).toThrow(/shots.*at least 1/);
    expect(() => validatePlanShape({ title: "Ep", scenes: [{ location: "kitchen", characters: [], shots: [{ ...shot, speaker: null }] }] })).toThrow(/dialogue without a speaker/);
    expect(() => validatePlanShape({ title: "Ep", scenes: [{ location: "kitchen", characters: [], shots: [{ ...shot, camera: 4 }] }] })).toThrow(/camera/);
    expect(() => validatePlanShape("nope")).toThrow(PlanShapeError);
  });

  it("validates block batches and bibles at the boundary", () => {
    expect(() => validateBlockScenesShape({ scenes: [{ location: "hall", characters: [], shots: [shot] }] })).not.toThrow();
    expect(() => validateBlockScenesShape({ scenes: [] })).toThrow(PlanShapeError);
    const character = (name: string) => ({
      name,
      description: "d",
      voice_design_prompt: "Adult woman, 30s",
      appearance: { age_look: "30s", hair: "auburn", face: "scar", body: "slim", default_wardrobe: "turtleneck" },
    });
    expect(() => validateBibleShape({ title: "T", logline: "L", characters: [character("A"), character("B"), character("C")] })).not.toThrow();
    expect(() => validateBibleShape({ title: "T", logline: "L", characters: [character("A")] })).toThrow(/at least 3/);
    expect(() => validateBibleShape({ title: "T", logline: "L", characters: [character("A"), character("B"), { name: "C" }] })).toThrow(/voice_design_prompt/);
  });
});
