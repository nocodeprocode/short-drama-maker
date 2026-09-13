import { describe, expect, it } from "vitest";
import { SCREENPLAY_RULES, type StoryBible } from "../../engine/domain.ts";
import { LENGTH_BUDGETS, lengthFromSeconds } from "../types/pacing.ts";
import { repairEpisodePlan } from "../lint/repair.ts";
import { validateEpisodePlan } from "../lint/validate-plan.ts";
import {
  commercialLongPlan,
  hookLedgerMonotonic,
  LongFormPlanningError,
  planLongFormEpisode,
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
        ethnicity_notes: "warm-olive",
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
        ethnicity_notes: "warm-olive",
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
        ethnicity_notes: "warm-olive",
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
  it("keeps 4–6 scene takes for a 90s chapter and a legal long range for 15 min", () => {
    expect(shotBudget(60)).toEqual({ min_shots: 4, max_shots: 6 });
    const long = shotBudget(900);
    expect(long.min_shots).toBeGreaterThanOrEqual(120);
    expect(long.max_shots).toBeLessThanOrEqual(200);
    expect(long.min_shots).toBeLessThan(long.max_shots);
    expect(LENGTH_BUDGETS["60_90"].min_shots).toBe(4);
    expect(LENGTH_BUDGETS["60_90"].max_shots).toBe(6);
    expect(LENGTH_BUDGETS["900_1080"].min_shots).toBe(120);
    expect(LENGTH_BUDGETS["900_1080"].max_shots).toBe(200);
    expect(lengthFromSeconds(38)).toBe("30_45");
    expect(lengthFromSeconds(60)).toBe("45_60");
    expect(lengthFromSeconds(90)).toBe("60_90");
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

describe("planLongFormEpisode with a writer", () => {
  it("surfaces a writer that keeps failing instead of shipping the kitchen template", async () => {
    let calls = 0;
    await expect(
      planLongFormEpisode({
        bible: BIBLE,
        episodeNumber: 1,
        outlineEpisode: async () => {
          calls += 1;
          throw new Error("HTTP 503");
        },
        writeEpisodeBlocks: async () => [],
      }),
    ).rejects.toBeInstanceOf(LongFormPlanningError);
    expect(calls).toBe(2);
  });

  it("rejects an outline with too few blocks and assigns block scenes by block_index, not position", async () => {
    const outline = synthesizeLongOutline({ bible: BIBLE });
    await expect(
      planLongFormEpisode({
        bible: BIBLE,
        episodeNumber: 1,
        outlineEpisode: async () => ({ ...outline, blocks: outline.blocks.slice(0, 4) }),
        writeEpisodeBlocks: async () => [],
        retries: 0,
      }),
    ).rejects.toThrow(/needs 12–18/);

    const plan = await planLongFormEpisode({
      bible: BIBLE,
      episodeNumber: 1,
      outlineEpisode: async () => outline,
      // The writer returns the batch's scenes in reverse and labels them itself.
      writeEpisodeBlocks: async ({ blocks }) =>
        [...blocks].reverse().map((block) => ({
          location: "night kitchen",
          time: "night",
          characters: CAST.slice(0, 2),
          block_index: block.index,
          shots: [
            { type: "dialogue" as const, speaker: CAST[0]!, dialogue: `Block ${block.index}.`, emotion: null, delivery: null, pace: null, camera: "tight single", mouth_visibility_required: true, duration_hint_seconds: 5 },
          ],
        })),
    });
    const byBlock = new Map(plan.scenes.map((scene) => [scene.block_index, scene.shots[0]?.dialogue]));
    for (const block of outline.blocks) expect(byBlock.get(block.index)).toBe(`Block ${block.index}.`);
  });
});

describe("short-plan fixture", () => {
  it("still budgets 4–6 scene takes for 60–90s", () => {
    const outline = synthesizeLongOutline({ bible: BIBLE });
    expect(outline.blocks.length).toBeGreaterThanOrEqual(12);
    expect(shotBudget(60).min_shots).toBe(4);
    expect(shotBudget(60).max_shots).toBe(6);
  });
});
