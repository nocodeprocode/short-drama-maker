import { describe, expect, it } from "vitest";
import { moderateText as edgeModerate } from "../../supabase/functions/_shared/moderation.ts";
import { moderateText as engineModerate } from "../engine/ai/moderation.ts";
import type { ModerationCheckpoint } from "../engine/domain.ts";

const CHECKPOINTS: ModerationCheckpoint[] = [
  "story_input",
  "character_create",
  "shot_submit",
  "dialogue",
];

/**
 * The cases where the two copies had drifted apart, plus the ones that keep the
 * gate honest. The edge copy used to ignore its checkpoint and block every
 * "looks like", so an API caller was refused text the engine would have shot.
 */
const CORPUS = [
  "Sarah Morgan, 27, confronts David in a penthouse kitchen.",
  "I know exactly what the receipt looks like.",
  "She looks like she has not slept in three days.",
  "Make her look like Zendaya",
  "a character resembling a real person",
  "I went to school with a girl named Voss.",
  "When I was a boy the kitchen was warmer.",
  "Good girl. Sit.",
  "Our children are grown and neither of them calls.",
  "She is 14 years old.",
  "A teenager in the doorway",
  "Tight single on a girl in the doorway",
  "His mother produces a child he never mentioned.",
  "they kiss in the doorway",
  "he pours whiskey and smiles",
  "she is snorting cocaine at the table",
  "a gun on the marble table",
  "explicit sex scene in the bedroom",
  "oversized white button-down worn as a sleep shirt",
  "A powerful family boss meets a night courier.",
  "",
];

describe("moderation parity", () => {
  it("agrees with the engine on every checkpoint it shares", () => {
    for (const checkpoint of CHECKPOINTS) {
      for (const content of CORPUS) {
        expect(edgeModerate(content, checkpoint), `${checkpoint}: ${content}`).toEqual(
          engineModerate(content, checkpoint),
        );
      }
    }
  });

  it("treats a story brief as a pictured subject, the way an unknown checkpoint does in the engine", () => {
    for (const content of CORPUS) {
      expect(edgeModerate(content, "story_idea")).toEqual(engineModerate(content, "story_input"));
      expect(edgeModerate(content, "story_script")).toEqual(engineModerate(content, "story_input"));
    }
  });
});
