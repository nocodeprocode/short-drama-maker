import { describe, expect, it } from "vitest";
import { SCREENPLAY_RULES, type StoryBible } from "../../engine/domain.ts";
import { LENGTH_BUDGETS, lengthFromSeconds } from "../types/pacing.ts";
import { repairEpisodePlan } from "../lint/repair.ts";
import { validateEpisodePlan } from "../lint/validate-plan.ts";
import {
  commercialLongPlan,
  hookLedgerMonotonic,
  shotBudget,
  synthesizeLongOutline,
} from "./long-form.ts";

const BIBLE: StoryBible = {
  title: "Tuesday Paper",
  logline: "A kitchen receipt names a werewolf billionaire.",
  characters: [
    {
      name: "Mara Voss",
      description: "Lead.",
      appearance: {
        age_look: "early thirties",
        ethnicity_notes: "unspecified fictional",
        hair: "auburn bun",
        face: "X-scar",
        body: "average",
        default_wardrobe: "ivory turtleneck",
      },
      personality: { core: "pressing" },
      relationships: {},
      voice_design_prompt: "Adult woman, cool alto.",
    },
    {
      name: "Eli Hart",
      description: "Wall.",
      appearance: {
        age_look: "mid thirties",
        ethnicity_notes: "unspecified fictional",
        hair: "dark",
        face: "open",
        body: "tall",
        default_wardrobe: "charcoal henley",
      },
      personality: { core: "evasive" },
      relationships: {},
      voice_design_prompt: "Adult man, low baritone.",
    },
    {
      name: "Jules Renner",
      description: "Witness.",
      appearance: {
        age_look: "late twenties",
        ethnicity_notes: "unspecified fictional",
        hair: "short",
        face: "sharp",
        body: "slight",
        default_wardrobe: "navy coat",
      },
      personality: { core: "watchful" },
      relationships: {},
      voice_design_prompt: "Adult woman, dry.",
    },
  ],
  locations: ["night kitchen", "estate lobby", "banquet hall"],
  episode_structure: [],
  visual_style: { format: "9:16" },
  rules: SCREENPLAY_RULES,
};

const CAST = BIBLE.characters.map((row) => row.name);

describe("shotBudget", () => {
  it("keeps 8–12 for a 60s chapter and a legal long range for 15 min", () => {
    expect(shotBudget(60)).toEqual({ min_shots: 8, max_shots: 12 });
    const long = shotBudget(900);
    expect(long.min_shots).toBeGreaterThanOrEqual(120);
    expect(long.max_shots).toBeLessThanOrEqual(200);
    expect(long.min_shots).toBeLessThan(long.max_shots);
    expect(LENGTH_BUDGETS["60_90"].min_shots).toBe(8);
    expect(LENGTH_BUDGETS["60_90"].max_shots).toBe(12);
    expect(LENGTH_BUDGETS["900_1080"].min_shots).toBe(120);
    expect(LENGTH_BUDGETS["900_1080"].max_shots).toBe(200);
    expect(lengthFromSeconds(900)).toBe("900_1080");
  });
});

describe("long-plan fixture", () => {
  it("has ≥12 blocks, mid reprice, final button, and a monotonic hook ledger", () => {
    const raw = commercialLongPlan(BIBLE);
    const repaired = repairEpisodePlan({ plan: raw, namedCast: CAST, length: "900_1080", episodeNumber: 1 });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    const sum = shots.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
    const lint = validateEpisodePlan({
      plan: repaired,
      namedCast: CAST,
      length: "900_1080",
      episodeNumber: 1,
    });
    expect(repaired.outline?.blocks.length).toBeGreaterThanOrEqual(12);
    expect(repaired.outline?.blocks.some((block) => block.reprice)).toBe(true);
    expect(hookLedgerMonotonic(repaired.outline!.blocks)).toBe(true);
    expect(shots.at(-1)?.function).toBe("button_cu");
    expect(shots.filter((shot) => shot.function === "button_cu")).toHaveLength(1);
    expect(shots.length).toBeGreaterThanOrEqual(120);
    expect(shots.length).toBeLessThanOrEqual(200);
    expect(sum).toBeGreaterThanOrEqual(780);
    expect(sum).toBeLessThanOrEqual(1020);
    expect(lint.pass).toBe(true);
  });
});

describe("short-plan fixture", () => {
  it("still budgets 8–12 for 60s", () => {
    const outline = synthesizeLongOutline({ bible: BIBLE });
    expect(outline.blocks.length).toBeGreaterThanOrEqual(12);
    expect(shotBudget(60).min_shots).toBe(8);
    expect(shotBudget(60).max_shots).toBe(12);
  });
});
