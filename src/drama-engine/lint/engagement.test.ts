import { describe, expect, it } from "vitest";
import { SCREENPLAY_RULES, type StoryBible } from "../../engine/domain.ts";
import { commercialLongPlan } from "../plans/long-form.ts";
import { repeatedKitchenPlan } from "./engagement.ts";
import { validateEpisodePlan } from "./validate-plan.ts";

const BIBLE: StoryBible = {
  title: "Tuesday Paper",
  logline: "Kitchen identity.",
  characters: [
    {
      name: "Mara Voss",
      description: "Lead.",
      appearance: {
        age_look: "30",
        ethnicity_notes: "warm-olive",
        hair: "auburn",
        face: "scar",
        body: "average",
        default_wardrobe: "ivory turtleneck",
      },
      personality: {},
      relationships: {},
      voice_design_prompt: "Adult woman.",
    },
    {
      name: "Eli Hart",
      description: "Wall.",
      appearance: {
        age_look: "34",
        ethnicity_notes: "warm-olive",
        hair: "dark",
        face: "open",
        body: "tall",
        default_wardrobe: "charcoal henley",
      },
      personality: {},
      relationships: {},
      voice_design_prompt: "Adult man.",
    },
    {
      name: "Jules Renner",
      description: "Witness.",
      appearance: {
        age_look: "28",
        ethnicity_notes: "warm-olive",
        hair: "short",
        face: "sharp",
        body: "slight",
        default_wardrobe: "navy coat",
      },
      personality: {},
      relationships: {},
      voice_design_prompt: "Adult woman.",
    },
  ],
  locations: ["night kitchen", "estate lobby"],
  episode_structure: [],
  visual_style: {},
  rules: SCREENPLAY_RULES,
};

const CAST = ["Mara Voss", "Eli Hart", "Jules Renner"];

describe("engagement lint", () => {
  it("fails a 15-min plan that is 15 copies of the same kitchen argument", () => {
    const seed = commercialLongPlan(BIBLE);
    const copies = repeatedKitchenPlan(seed, 15);
    const lint = validateEpisodePlan({
      plan: copies,
      namedCast: CAST,
      length: "900_1080",
      episodeNumber: 1,
    });
    expect(lint.pass).toBe(false);
    expect(lint.blocking.some((row) => row.id === "REPEAT_BEAT")).toBe(true);
  });
});
