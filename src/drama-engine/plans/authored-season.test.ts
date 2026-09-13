import { describe, expect, it } from "vitest";
import type { StoryBible } from "../../engine/domain.ts";
import { SCREENPLAY_RULES } from "../../engine/domain.ts";
import { dramaHooks } from "../integration/hooks.ts";
import { assertSeasonBible, buildSeasonBible, SEASON_EPISODE_COUNT } from "./season-bible.ts";

const CAST: StoryBible["characters"] = [
  { name: "Mara Voss", description: "Engine", appearance: { age_look: "30", ethnicity_notes: "warm-olive", hair: "dark", face: "sharp", body: "average", default_wardrobe: "charcoal blazer" }, personality: { core: "principled" }, relationships: {}, voice_design_prompt: "Adult woman, thirties, even." },
  { name: "Eli Kane", description: "Wall", appearance: { age_look: "34", ethnicity_notes: "warm-olive", hair: "black", face: "closed", body: "tall", default_wardrobe: "black coat" }, personality: { core: "cold" }, relationships: {}, voice_design_prompt: "Adult man, thirties, low." },
  { name: "Nora Hale", description: "Witness", appearance: { age_look: "32", ethnicity_notes: "warm-olive", hair: "black", face: "calm", body: "average", default_wardrobe: "navy knit" }, personality: { core: "watchful" }, relationships: {}, voice_design_prompt: "Adult woman, thirties, brief." },
  { name: "Jules Renner", description: "Nuke", appearance: { age_look: "29", ethnicity_notes: "warm-olive", hair: "blonde", face: "open", body: "slight", default_wardrobe: "silk blouse" }, personality: { core: "hidden" }, relationships: {}, voice_design_prompt: "Adult woman, twenties, bright." },
];

function authoredBible(): StoryBible {
  return {
    title: "The Signed Contract Wife",
    logline: "A dated letter names the woman the room was told to discard.",
    characters: CAST,
    locations: ["corner office at night", "estate kitchen", "lobby after hours"],
    episode_structure: Array.from({ length: 12 }, (_, i) => ({
      episode_number: i + 1,
      title: `Chapter ${i + 1}`,
      hook: `Author beat ${i + 1} opens the room.`,
      conflict: `Author conflict ${i + 1}.`,
      cliffhanger: `Author cliff ${i + 1}.`,
      source_beats: [`Beat A${i + 1}`, `Beat B${i + 1}`, `Beat C${i + 1}`],
      source_dialogue: [`You signed it, not me. (${i + 1})`],
    })),
    visual_style: { format: "9:16" },
    rules: SCREENPLAY_RULES,
    source: "script",
  };
}

describe("authored season log", () => {
  it("follows the writer's hooks past episode 3 instead of genre beats", () => {
    const season = assertSeasonBible(buildSeasonBible(authoredBible()));
    expect(season.episode_log).toHaveLength(SEASON_EPISODE_COUNT);
    // Episode 7 is well past the old ep<=3 cutoff and past the paywall episode.
    expect(season.episode_log[6]?.logline).toContain("Author beat 7");
    expect(season.episode_log[11]?.logline).toContain("Author beat 12");
    // Beyond the uploaded script the genre spine still fills the season.
    expect(season.episode_log[40]?.logline).toMatch(/act3/);
  });

  it("still uses the genre spine when the story came from a brief", () => {
    const brief = { ...authoredBible(), source: "brief" as const };
    const season = assertSeasonBible(buildSeasonBible(brief));
    expect(season.episode_log[6]?.logline).not.toContain("Author beat 7");
  });
});

describe("authored episode prompt", () => {
  it("tells the writer to adapt the uploaded beats, not invent", () => {
    const prompt = dramaHooks.writeEpisodeUserPrompt({ bible: authoredBible(), episodeNumber: 4, length: "60_90" });
    expect(prompt).toContain("ADAPTED, NOT INVENTED");
    expect(prompt).toContain("Beat A4");
    expect(prompt).toContain("You signed it, not me. (4)");
    expect(prompt).not.toContain("Beat A5");
  });

  it("leaves the invent-a-season prompt alone for brief-sourced shows", () => {
    const brief = { ...authoredBible(), source: "brief" as const };
    const prompt = dramaHooks.writeEpisodeUserPrompt({ bible: brief, episodeNumber: 4, length: "60_90" });
    expect(prompt).not.toContain("ADAPTED, NOT INVENTED");
  });
});
