import { describe, expect, it } from "vitest";
import { GENRE_IDS } from "../../drama-engine/types/genre.ts";
import { playbookFor } from "../../drama-engine/craft/genre-playbooks.ts";
import { SEASON_CAST_MAX, SEASON_CAST_MIN } from "../../drama-engine/plans/season-bible.ts";
import { buildCastSlate, isStoryDevice, JOBS_BY_POSITION, slotDisplayName } from "./slate.ts";

describe("buildCastSlate", () => {
  it("builds 4–5 structured slots for every genre", () => {
    for (const genre of GENRE_IDS) {
      const slots = buildCastSlate({ genre });
      expect(slots.length).toBeGreaterThanOrEqual(SEASON_CAST_MIN);
      expect(slots.length).toBeLessThanOrEqual(SEASON_CAST_MAX);
      expect(slots.map((slot) => slot.job).sort()).toEqual(
        [...new Set(slots.map((slot) => slot.job))].sort(),
      );
      for (const job of JOBS_BY_POSITION) {
        expect(slots.some((slot) => slot.job === job)).toBe(true);
      }
    }
  });

  it("infers billionaire from a contract brief and flags a DNA-sheet nuke as a device", () => {
    const slots = buildCastSlate({ title: "The Signed Wife", idea: "A broke secretary is bound by a contract to a CEO." });
    expect(slots[0]?.job).toBe("engine");
    expect(slots[0]?.label).toBe("Lead");
    expect(slots[0]?.castable).toBe(true);
    expect(slots.find((slot) => slot.job === "nuke")?.castable).toBe(false);
    const hidden = buildCastSlate({ title: "Secret Baby", idea: "A hidden DNA test relabels everyone." });
    const nuke = hidden.find((slot) => slot.job === "nuke");
    expect(nuke?.castable).toBe(false);
    expect(nuke?.archetype).toMatch(/DNA/i);
  });

  it("keeps a kidnapped Luna castable and treats a clause-only nuke as a device", () => {
    expect(isStoryDevice("nuke", "true-mate mark / kidnapped Luna")).toBe(false);
    expect(isStoryDevice("nuke", "test / locket / DNA sheet")).toBe(true);
    expect(isStoryDevice("nuke", "the clause / the deed")).toBe(true);
    expect(isStoryDevice("nuke", "hidden heir / leaked NDA")).toBe(true);
    expect(isStoryDevice("nuke", "hidden heir")).toBe(false);
    expect(isStoryDevice("engine", "contract wife / secretary")).toBe(false);
    const playbook = playbookFor("hidden_identity");
    expect(playbook.requiredArchetypes.some((row) => row.job === "nuke")).toBe(true);
  });

  it("titles a person by name and never headlines a device phrase as a face", () => {
    expect(slotDisplayName({ suggested_name: "Mara Quinn", archetype: "CEO", label: "Antagonist" })).toBe("Mara Quinn");
    expect(slotDisplayName({ archetype: "CEO", label: "Antagonist", castable: true })).toBe("Unnamed Antagonist");
    expect(slotDisplayName({ archetype: "hidden heir / leaked NDA", label: "Disruptor", castable: false })).toBe(
      "hidden heir / leaked NDA",
    );
  });
});
