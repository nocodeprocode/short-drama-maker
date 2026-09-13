import { describe, expect, it } from "vitest";
import { GENRE_IDS } from "../../drama-engine/types/genre.ts";
import {
  buildDesignSlate,
  classifyDesignPhrase,
  DESIGN_LOCATION_MAX,
  DESIGN_LOCATION_MIN,
  DESIGN_PROP_MAX,
  DESIGN_PROP_MIN,
  propAssetKey,
  propKindFor,
  propsFromArchetype,
  sameDesignThing,
} from "./slate.ts";

describe("classifyDesignPhrase", () => {
  it("reads a room as a location and an object as a prop", () => {
    expect(classifyDesignPhrase("glass office")).toEqual({ kind: "location", name: "glass office" });
    expect(classifyDesignPhrase("hospital corridor")).toEqual({ kind: "location", name: "hospital corridor" });
    // "board" is a film slate unless we expand it into the room the playbook meant.
    expect(classifyDesignPhrase("board")).toEqual({ kind: "location", name: "boardroom" });
    expect(classifyDesignPhrase("board vote")).toEqual({ kind: "location", name: "boardroom" });
    expect(classifyDesignPhrase("ring box")).toEqual({ kind: "prop", name: "ring box" });
    expect(classifyDesignPhrase("NDA")).toEqual({ kind: "prop", name: "NDA" });
  });

  it("drops the qualifier tail a playbook writes for the camera department", () => {
    expect(classifyDesignPhrase("private office claim")?.name).toBe("private office");
    expect(classifyDesignPhrase("safehouse forced intimacy")?.name).toBe("safehouse");
    expect(classifyDesignPhrase("contract insert readable in 2s")?.name).toBe("contract insert");
    expect(classifyDesignPhrase("dated newspaper labeled LAST LIFE")?.name).toBe("dated newspaper");
  });

  it("refuses directions that are not things we can generate", () => {
    expect(classifyDesignPhrase("gun implied off-frame")).toBeNull();
    expect(classifyDesignPhrase("one timeline on screen")).toBeNull();
    expect(classifyDesignPhrase("vow catchphrase")).toBeNull();
    expect(classifyDesignPhrase("tattoos")).toBeNull();
    // A beat, not a room.
    expect(classifyDesignPhrase("wake node")).toBeNull();
    expect(classifyDesignPhrase("original crime")).toBeNull();
  });

  it("lets the room win when a phrase names both", () => {
    expect(classifyDesignPhrase("hospital bill")).toEqual({ kind: "location", name: "hospital" });
  });
});

describe("buildDesignSlate", () => {
  it("gives every genre enough places and objects to shoot", () => {
    for (const genre of GENRE_IDS) {
      const slate = buildDesignSlate({ genre });
      expect(slate.locations.length).toBeGreaterThanOrEqual(DESIGN_LOCATION_MIN);
      expect(slate.locations.length).toBeLessThanOrEqual(DESIGN_LOCATION_MAX);
      expect(slate.props.length).toBeGreaterThanOrEqual(DESIGN_PROP_MIN);
      expect(slate.props.length).toBeLessThanOrEqual(DESIGN_PROP_MAX);
      for (const row of slate.locations) expect(row.kind).toBe("location");
      for (const row of slate.props) expect(row.kind).toBe("prop");
      // Positions are dense per bucket, so the UI can order them.
      expect(slate.locations.map((row) => row.position)).toEqual(slate.locations.map((_, index) => index));
      expect(slate.props.map((row) => row.position)).toEqual(slate.props.map((_, index) => index));
    }
  });

  it("splits a contract brief into rooms and objects, never mixing them", () => {
    const slate = buildDesignSlate({
      title: "The Signed Contract Wife",
      idea: "A broke secretary is bound by a contract to a CEO.",
    });
    const locations = slate.locations.map((row) => row.name);
    const props = slate.props.map((row) => row.name);
    expect(locations).toContain("glass office");
    expect(locations).toContain("hospital corridor");
    expect(locations).toContain("boardroom");
    expect(locations).not.toContain("board");
    expect(props).toContain("NDA");
    expect(props).toContain("ring box");
    // A car is somewhere we shoot, not an object on a table.
    expect(locations).toContain("black car");
    expect(props).not.toContain("black car");
  });

  it("turns a story element the cast sheet refused into a prop", () => {
    expect(propsFromArchetype("hidden heir / leaked NDA")).toEqual(["leaked NDA"]);
    expect(propsFromArchetype("the clause / the deed")).toEqual(["the clause", "the deed"]);
    // A person nuke stays out of the prop list.
    expect(propsFromArchetype("true-mate mark / kidnapped Luna")).toEqual(["true-mate mark"]);

    const slate = buildDesignSlate({ genre: "legal_medical", deviceArchetypes: ["the clause / the deed"] });
    expect(slate.props.map((row) => row.name)).toContain("the clause");
  });

  it("lists one object when the brief and the plot name it at two lengths", () => {
    const slate = buildDesignSlate({ genre: "billionaire", deviceArchetypes: ["hidden heir / leaked NDA"] });
    const props = slate.props.map((row) => row.name);
    // The playbook's bare "NDA" and the plot's "leaked NDA" are one prop, and
    // the more specific name is the one we shoot.
    expect(props).toContain("leaked NDA");
    expect(props).not.toContain("NDA");
    expect(props.filter((name) => /nda/i.test(name))).toHaveLength(1);
  });

  it("never lists the same place or object twice", () => {
    const slate = buildDesignSlate({ genre: "werewolf" });
    const names = slate.locations.map((row) => row.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("sameDesignThing", () => {
  it("matches a name against a longer version of itself, on whole words only", () => {
    expect(sameDesignThing("NDA", "leaked NDA")).toBe(true);
    expect(sameDesignThing("gala", "uninvited gala")).toBe(true);
    expect(sameDesignThing("penthouse", "penthouse living room")).toBe(true);
    // Not the same object, and not a substring trap.
    expect(sameDesignThing("car", "carrier")).toBe(false);
    expect(sameDesignThing("glass office", "private office")).toBe(false);
  });
});

describe("prop asset keys", () => {
  it("keys a prop the way the engine's prop bible looks it up", () => {
    expect(propAssetKey("leaked NDA")).toBe("prop:text:leaked-nda");
    expect(propKindFor("leaked NDA")).toBe("contract");
    expect(propKindFor("sealed letter")).toBe("letter");
    expect(propKindFor("face-down phone")).toBe("phone");
    expect(propKindFor("jade token")).toBeNull();
  });
});
