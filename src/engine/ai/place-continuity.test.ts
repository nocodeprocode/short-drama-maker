import { describe, expect, it } from "vitest";
import { parseLocationNotes, parsePlaceContinuity, PLACE_CONTINUITY_RUBRIC } from "./vision.ts";

describe("place continuity judge", () => {
  it("rejects a view whose furniture moved within the floor plan", () => {
    expect(
      parsePlaceContinuity('{"consistent":false,"camera_correct":true,"notes":"The table rotated ninety degrees."}', "test"),
    ).toMatchObject({
      consistent: false,
      camera_correct: true,
      notes: "The table rotated ninety degrees.",
    });
    expect(PLACE_CONTINUITY_RUBRIC).toMatch(/rotated within the floor plan/i);
  });

  it("identifies production equipment inside a story location", () => {
    const result = parseLocationNotes(
      JSON.stringify({
        people_present: false,
        placeholder_lettering: false,
        production_gear_present: true,
        palette: "walnut amber",
        key_light: "window right",
        dressing: ["chandelier"],
        lighting_lock: "Warm window light.",
        geometry: "Open parquet floor.",
      }),
      "test",
    );
    expect(result.production_gear_present).toBe(true);
  });
});
