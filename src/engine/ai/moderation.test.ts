import { describe, expect, it } from "vitest";
import { moderateText } from "./moderation.ts";

describe("moderation.adult_reference", () => {
  it("lets adults talk about their past in dialogue, still blocks a depicted or explicit minor", () => {
    expect(moderateText("I went to school with a girl named Voss.", "dialogue").verdict).toBe("allow");
    expect(moderateText("When I was a boy the kitchen was warmer.", "dialogue").verdict).toBe("allow");
    expect(moderateText("Good girl. Sit.", "dialogue").verdict).toBe("allow");
    expect(moderateText("She is 14 years old.", "dialogue").verdict).toBe("block");
    expect(moderateText("A teenager in the doorway", "dialogue").verdict).toBe("block");
    expect(moderateText("Tight single on a girl in the doorway", "shot_submit").verdict).toBe("block");
    expect(moderateText("Tight single on Mara, who went to school with a girl named Voss", "shot_submit").verdict).toBe("allow");
  });
});

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
