import { describe, expect, it } from "vitest";
import { pageItems } from "@/components/drama/catalog-pagination.tsx";
import { fuzzySearch } from "./fuzzy-search.ts";

const items = [
  { name: "Glass Office", tags: ["corporate"], shows: ["Hostile Merger"] },
  { name: "Signing Table", tags: ["contract"], shows: ["The Agreement"] },
  { name: "Penthouse Kitchen", tags: ["luxury"], shows: ["Hidden Heir"] },
];

describe("catalog discovery", () => {
  it("finds and ranks typo-tolerant name matches", () => {
    expect(fuzzySearch(items, "glas ofice", (item) => [...item.tags, ...item.shows])[0]?.name).toBe("Glass Office");
  });

  it("searches tags and show names", () => {
    expect(fuzzySearch(items, "hostile merger", (item) => [...item.tags, ...item.shows]).map((item) => item.name)).toEqual([
      "Glass Office",
    ]);
    expect(fuzzySearch(items, "luxry", (item) => item.tags)[0]?.name).toBe("Penthouse Kitchen");
  });

  it("returns a stable page and clamps an out-of-range page", () => {
    expect(pageItems(items, 2, 2).map((item) => item.name)).toEqual(["Penthouse Kitchen"]);
    expect(pageItems(items, 99, 2).map((item) => item.name)).toEqual(["Penthouse Kitchen"]);
  });
});
