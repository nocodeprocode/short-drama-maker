import { describe, expect, it } from "vitest";
import type { StoryBible } from "../../engine/domain.ts";
import { SCREENPLAY_RULES } from "../../engine/domain.ts";
import { assertSeasonBible, buildSeasonBible, SEASON_EPISODE_COUNT, SEASON_PAYWALL_EPISODE } from "./season-bible.ts";

const BIBLE: StoryBible = {
  title: "The Signed Contract Wife",
  logline: "A dated letter names the woman the room was told to discard.",
  characters: [
    { name: "Mara Voss", description: "Engine", appearance: { age_look: "30", ethnicity_notes: "unspecified fictional", hair: "dark", face: "sharp", body: "average", default_wardrobe: "charcoal blazer" }, personality: { core: "principled" }, relationships: {}, voice_design_prompt: "Adult woman, thirties, even." },
    { name: "Eli Kane", description: "Wall", appearance: { age_look: "34", ethnicity_notes: "unspecified fictional", hair: "black", face: "closed", body: "tall", default_wardrobe: "black coat" }, personality: { core: "cold" }, relationships: {}, voice_design_prompt: "Adult man, thirties, low." },
    { name: "Nora Hale", description: "Witness", appearance: { age_look: "32", ethnicity_notes: "unspecified fictional", hair: "black", face: "calm", body: "average", default_wardrobe: "navy knit" }, personality: { core: "watchful" }, relationships: {}, voice_design_prompt: "Adult woman, thirties, brief." },
    { name: "Jules Renner", description: "Nuke", appearance: { age_look: "29", ethnicity_notes: "unspecified fictional", hair: "blonde", face: "open", body: "slight", default_wardrobe: "silk blouse" }, personality: { core: "hidden" }, relationships: {}, voice_design_prompt: "Adult woman, twenties, bright." },
  ],
  locations: ["corner office at night", "estate kitchen", "lobby after hours"],
  episode_structure: [{ episode_number: 1, title: "The Letter", hook: "The paper is dated Tuesday.", conflict: "The name is not hers." }],
  visual_style: { format: "9:16" },
  rules: SCREENPLAY_RULES,
};

describe("season bible", () => {
  it("builds a 60-ep four-act spine with loops, paywall 10, and three guns", () => {
    const season = assertSeasonBible(buildSeasonBible(BIBLE));
    expect(season.title.split(/\s+/).length).toBeGreaterThanOrEqual(4);
    expect(season.title.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(season.acts).toHaveLength(4);
    expect(season.acts[0]?.episodes).toEqual([1, 15]);
    expect(season.paywall_episode).toBe(SEASON_PAYWALL_EPISODE);
    expect(season.planted_guns).toHaveLength(3);
    expect(season.characters.length).toBeGreaterThanOrEqual(4);
    expect(season.characters.length).toBeLessThanOrEqual(5);
    expect(season.locations.length).toBeGreaterThanOrEqual(3);
    expect(season.locations.length).toBeLessThanOrEqual(5);
    expect(season.episode_log).toHaveLength(SEASON_EPISODE_COUNT);
    expect(new Set(season.episode_log.map((row) => row.logline)).size).toBe(SEASON_EPISODE_COUNT);
    expect(season.loops).toHaveLength(8);
    expect(season.core_expectation).toMatch(/\?$/);
    expect(season.episode_log[9]?.logline).toMatch(/paywall/i);
    expect(season.playbook_id).toBe("billionaire");
  });
});
