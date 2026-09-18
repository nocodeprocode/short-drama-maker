import { describe, expect, it } from "vitest";
import { presentLocation, presentProp } from "../../supabase/functions/_shared/design.ts";

const location = {
  id: "loc-1",
  series_id: "s-1",
  name: "glass office",
  note: "",
  origin: "slate",
  position: 0,
  plate_asset_id: "plate-1",
  lighting_lock: "window left",
  status: "ready",
  locked: false,
  error: null,
};

const prop = {
  id: "prop-1",
  series_id: "s-1",
  name: "leaked NDA",
  note: "",
  origin: "slate",
  position: 0,
  still_asset_id: "still-1",
  kind: "contract",
  state: null,
  status: "ready",
  locked: false,
  error: null,
  cast_slot_id: null,
};

describe("design presenters", () => {
  it("includes labeled room angles on a place row", () => {
    const row = presentLocation(location, {
      plate_url: "https://mem/office",
      angles: [
        { angle: "opposite", url: "https://mem/office-opposite" },
        { angle: "overhead", url: "https://mem/office-overhead" },
      ],
    });
    expect(row.angles).toEqual([
      { angle: "opposite", url: "https://mem/office-opposite" },
      { angle: "overhead", url: "https://mem/office-overhead" },
    ]);
    expect(row.plate_url).toBe("https://mem/office");
  });

  it("includes extra object views on a prop row", () => {
    const row = presentProp(prop, {
      still_url: "https://mem/nda",
      angles: [{ angle: "reverse", url: "https://mem/nda-back" }],
    });
    expect(row.angles).toEqual([{ angle: "reverse", url: "https://mem/nda-back" }]);
    expect(row.still_url).toBe("https://mem/nda");
    expect(row.document_text).toBeNull();
  });

  it("surfaces the written contract on a document row", () => {
    const row = presentProp(prop, {
      still_url: "https://mem/nda",
      document_text: "NON-DISCLOSURE AGREEMENT\nDate 10\nThis agreement is made on 10.",
    });
    expect(row.document_text).toMatch(/NON-DISCLOSURE AGREEMENT/);
  });
});
