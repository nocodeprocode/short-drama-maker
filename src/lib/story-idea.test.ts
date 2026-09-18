import { describe, expect, it } from "vitest";
import { applyLocks, partialJsonString, type StoryIdea } from "../../supabase/functions/_shared/story-idea.ts";

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
