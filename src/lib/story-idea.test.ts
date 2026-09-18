import { describe, expect, it } from "vitest";
import {
  applyLocks,
  buyerText,
  FALLBACKS,
  partialJsonString,
  seasonOrder,
  STORY_DIRECTIONS,
  type StoryIdea,
} from "../../supabase/functions/_shared/story-idea.ts";
import { moderateText } from "../../supabase/functions/_shared/moderation.ts";

describe("story brief preservation", () => {
  it("never truncates a generated brief or an appended lock", () => {
    const ending = "This is the complete final sentence.";
    const brief = `${"A detailed season beat. ".repeat(180)}${ending}`;
    const idea: StoryIdea = { title: "Full Story", brief, category: "contract" };

    const locked = applyLocks(idea, {
      lead: "Yacine",
      opposite: "",
      setting: "",
    });

    expect(locked.brief).toContain(ending);
    expect(locked.brief).toContain("Cast lock: Yacine");
    expect(locked.brief.length).toBeGreaterThan(4_000);
  });

  it("extracts a brief safely while streamed JSON is still incomplete", () => {
    const partial = String.raw`{"title":"A Contract","brief":"First line.\nSecond \"quoted\" line`;
    expect(partialJsonString(partial, "title")).toBe("A Contract");
    expect(partialJsonString(partial, "brief")).toBe('First line.\nSecond "quoted" line');
  });
});

/**
 * The buyer picks the episode count before the brief is written. A writer that
 * never sees the count writes episode 1 and stops, which reads like a film.
 */
describe("season order reaches the writer", () => {
  it("carries the ordered count and the seconds per episode", () => {
    expect(seasonOrder(15, "45_60")).toEqual({ episodes: 15, seconds: 60 });
    expect(seasonOrder(90, "120_180")).toEqual({ episodes: 90, seconds: 120 });
  });

  it("falls back to the default order instead of writing a zero-episode season", () => {
    expect(seasonOrder(undefined, undefined)).toEqual({ episodes: 30, seconds: 90 });
    expect(seasonOrder(0, "nonsense")).toEqual({ episodes: 30, seconds: 90 });
  });

  it("clamps an out-of-catalog count to what we actually sell", () => {
    expect(seasonOrder(4, "60_90").episodes).toBe(15);
    expect(seasonOrder(500, "60_90").episodes).toBe(90);
  });
});

/**
 * A canned premise is only allowed to stand in when the buyer locked nothing, so
 * every fallback has to survive the same gate a generated brief does. One of
 * them used to name a child, which the gate rejects.
 */
/**
 * Every chip on the new-show page has to be usable. "Secret child" used to
 * reject itself: its own label was moderated as if the buyer had typed it.
 */
describe("story direction chips", () => {
  it("never rejects a direction on the strength of its own label", () => {
    for (const direction of STORY_DIRECTIONS) {
      const typed = buyerText({
        category: direction.id,
        hint: "Reincarnation",
        lead: "Mafia Heiress",
        opposite: "Delivery driver",
        setting: "Family estate",
      });
      expect(typed).not.toContain(direction.label);
      expect(moderateText(typed, "story_idea_hint").verdict).toBe("allow");
    }
  });

  it("still rejects a minor the buyer typed themselves", () => {
    expect(moderateText(buyerText({ lead: "a 14 year old bride" }), "story_idea_hint").verdict).toBe("block");
  });
});

describe("fallback briefs", () => {
  it("passes the same gate a generated brief has to pass", () => {
    for (const fallback of FALLBACKS) {
      expect(moderateText(`${fallback.title}\n${fallback.brief}`, "story_idea").verdict).toBe("allow");
    }
  });

  it("describes a season with a running engine, not a logline", () => {
    for (const fallback of FALLBACKS) {
      expect(fallback.brief).toMatch(/season engine/i);
      expect(fallback.brief.split(/(?<=[.!?])\s+/).length).toBeGreaterThanOrEqual(8);
    }
  });
});
