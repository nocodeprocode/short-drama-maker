import { describe, expect, it } from "vitest";
import { locationRefForScene, pinLocationToBible } from "./location-ref.ts";

const REFS = {
  "The Khalil apartment — a tidy, well-furnished flat that feels curated rather than lived-in; the home office is where the ledger lives":
    "apt",
  "The archive office — rows of shelved files, warm overhead fluorescents, two desks facing each other where Nadia and Selin work":
    "archive",
  "The building corridor outside the Khalil apartment — narrow, neutral, a liminal space for confrontations that cannot happen inside":
    "corridor",
  "Faris's firm reception area — glass, grey stone, a waiting area with two chairs that face each other across a low table":
    "firm",
  "A street-level café near the archive — small, quiet, the place Nadia and Selin go when a conversation cannot happen at a desk":
    "cafe",
};

describe("locationRefForScene", () => {
  it("returns an exact key", () => {
    expect(locationRefForScene(REFS, "The building corridor outside the Khalil apartment — narrow, neutral, a liminal space for confrontations that cannot happen inside")).toBe(
      "corridor",
    );
  });

  it("matches a shortened scene string on the first clause", () => {
    expect(locationRefForScene(REFS, "The Khalil apartment — home office")).toBe("apt");
    expect(
      locationRefForScene(
        REFS,
        "The archive office — rows of shelved files, warm overhead fluorescents, two desks facing each other",
      ),
    ).toBe("archive");
  });

  it("does not invent a location or fall back to the first key", () => {
    expect(locationRefForScene(REFS, "A rooftop that is not in the bible")).toBeNull();
    expect(locationRefForScene({}, "The archive office")).toBeNull();
  });
});

describe("pinLocationToBible", () => {
  const bible = Object.keys(REFS);

  it("keeps a verbatim bible location", () => {
    expect(pinLocationToBible(bible[1]!, bible)).toBe(bible[1]);
  });

  it("pins a shortened scene location to the bible string", () => {
    expect(pinLocationToBible("The Khalil apartment — home office", bible)).toBe(bible[0]);
  });
});
