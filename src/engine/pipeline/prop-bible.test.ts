import { describe, expect, it } from "vitest";
import { objectLettering, objectViewLabel, objectViews } from "./prop-bible.ts";

describe("object lettering", () => {
  it("leaves a ring box blank instead of inventing a jeweller", () => {
    expect(objectLettering("ring box")).toMatch(/no printed lettering/i);
    expect(objectLettering("ring box")).toMatch(/Blank lid/);
    expect(objectLettering("ring box")).not.toMatch(/ESTHERY|Yandex|SAMPLE|LOCATION/);
  });

  it("allows one real heading on a document and otherwise prefers none", () => {
    expect(objectLettering("leaked NDA")).toMatch(/one short real heading/);
    expect(objectLettering("leaked NDA")).toMatch(/date reads 10/);
    expect(objectLettering("brass lamp")).toMatch(/No printed lettering/);
  });
});

describe("object views", () => {
  it("gives a document a back and a ring box an open lid", () => {
    expect(objectViews("leaked NDA").map((row) => row.angle)).toEqual(["reverse"]);
    expect(objectViews("ring box").map((row) => row.angle)).toEqual(["open"]);
    expect(objectViews("face-down phone").map((row) => row.angle)).toEqual(["reverse"]);
    expect(objectViews("closed watch").map((row) => row.angle)).toEqual(["profile"]);
    expect(objectViewLabel("reverse")).toBe("Back");
    expect(objectViewLabel("open")).toBe("Open");
  });

  it("leaves a generic object as one still", () => {
    expect(objectViews("brass lamp")).toEqual([]);
    expect(objectViews("sofa")).toEqual([]);
    expect(objectViews("")).toEqual([]);
  });
});
