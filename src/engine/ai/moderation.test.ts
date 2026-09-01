import { describe, expect, it } from "vitest";
import { moderateText } from "./moderation.ts";

describe("moderation gate", () => {
  it("allows fictional adult drama", () => {
    const verdict = moderateText(
      "Sarah Morgan, 27, confronts David in a penthouse kitchen.",
      "story_input",
    );
    expect(verdict.verdict).toBe("allow");
  });

  it("blocks real-person likeness", () => {
    expect(moderateText("Make her look like Zendaya", "character_create").category).toBe(
      "real_person_likeness",
    );
  });

  it("allows object looks-like in fictional dialogue", () => {
    expect(
      moderateText("I know exactly what the receipt looks like.", "shot_submit").verdict,
    ).toBe("allow");
  });

  it("blocks minors", () => {
    expect(moderateText("A 12 year old girl finds out the secret", "story_input").category).toBe(
      "minor",
    );
  });

  it("blocks sexual content", () => {
    expect(moderateText("explicit sex scene in the bedroom", "shot_submit").category).toBe(
      "sexual",
    );
  });

  it("blocks underdressed wardrobe notes", () => {
    expect(
      moderateText("oversized white button-down worn as a sleep shirt", "character_create")
        .category,
    ).toBe("sexual");
  });
});
