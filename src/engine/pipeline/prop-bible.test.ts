import { describe, expect, it } from "vitest";
import {
  documentPrompt,
  fallbackDocument,
  isReadableDocument,
  normalizeWrittenDocument,
  objectLettering,
  objectViewLabel,
  objectViews,
  propFromLockText,
} from "./prop-bible.ts";

describe("object lettering", () => {
  it("leaves a ring box blank instead of inventing a jeweller", () => {
    expect(objectLettering("ring box")).toMatch(/no printed lettering/i);
    expect(objectLettering("ring box")).toMatch(/Blank lid/);
    expect(objectLettering("ring box")).not.toMatch(/ESTHERY|Yandex|SAMPLE|LOCATION/);
  });

  it("typesets exact document words and otherwise prefers none", () => {
    expect(isReadableDocument("leaked NDA")).toBe(true);
    expect(objectLettering("leaked NDA")).toMatch(/exact words given in the description/);
    expect(objectLettering("leaked NDA")).toMatch(/date reads 10/);
    expect(objectLettering("brass lamp")).toMatch(/No printed lettering/);
    expect(propFromLockText("leaked NDA")?.prompt).toMatch(/letter-perfect/);
    expect(propFromLockText("leaked NDA")?.prompt).not.toMatch(/no readable text/);
  });

  it("writes a real sample contract instead of dummy copy", () => {
    const doc = fallbackDocument({
      name: "leaked NDA",
      parties: ["Elena Voss", "Marcus Hale"],
      title: "Claws in the Contract",
    });
    expect(doc.heading).toBe("NON-DISCLOSURE AGREEMENT");
    expect(doc.date).toBe("10");
    expect(doc.body).toMatch(/Elena Voss/);
    expect(doc.body).toMatch(/Marcus Hale/);
    expect(doc.body).not.toMatch(/lorem|NDAEM|Sleaked/i);
    expect(documentPrompt("leaked NDA", doc)).toMatch(/Typeset this exact document/);
    expect(documentPrompt("leaked NDA", doc)).toMatch(/NON-DISCLOSURE AGREEMENT/);
    expect(normalizeWrittenDocument({ heading: "x", body: "too short" }, doc)).toEqual(doc);
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
