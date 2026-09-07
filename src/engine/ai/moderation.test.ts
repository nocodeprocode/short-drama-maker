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

  it("allows a normal short drama and still blocks drugs, nudity, and weapons", () => {
    expect(moderateText("they kiss in the doorway", "shot_submit").verdict).toBe("allow");
    expect(moderateText("he pours whiskey and smiles", "shot_submit").verdict).toBe("allow");
    expect(moderateText("she is snorting cocaine at the table", "shot_submit").category).toBe("uae_media");
    expect(moderateText("a gun on the marble table", "shot_submit").category).toBe("uae_media");
    expect(moderateText("A powerful family boss meets a night courier.", "story_input").verdict).toBe("allow");
  });

  it("blocks underdressed wardrobe notes", () => {
    expect(
      moderateText("oversized white button-down worn as a sleep shirt", "character_create")
        .category,
    ).toBe("sexual");
  });

  it("allows the live closeness and beauty clauses on a shot submit", async () => {
    const { CAST_LOOK_CLAUSE, FACE_DISTANCE_CLAUSE, sceneTakePrompt } = await import(
      "../../drama-engine/craft/prompt-fragments.ts"
    );
    expect(moderateText(CAST_LOOK_CLAUSE, "shot_submit").verdict).toBe("allow");
    expect(moderateText(FACE_DISTANCE_CLAUSE, "shot_submit").verdict).toBe("allow");
    expect(
      moderateText(
        sceneTakePrompt({
          location: "kitchen",
          camera: "Medium two-shot",
          people: ["MARA", "COLE"],
          sceneScript: "MARA: I can't go there.\nCOLE: You're burning up.",
        }),
        "shot_submit",
      ).verdict,
    ).toBe("allow");
  });
});
