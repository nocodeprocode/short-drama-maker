import { describe, expect, it } from "vitest";
import { packHasGap, packTiles } from "./actor-pack.ts";

describe("face pack tiles", () => {
  it("shows the holes a failed pack left behind", () => {
    const tiles = packTiles([
      { kind: "front", url: "https://s/front.jpg", label: "Front" },
      { kind: "three_quarter", url: "https://s/tq.jpg", label: "Three-quarter" },
    ]);
    expect(tiles.map((tile) => tile.kind)).toEqual(["front", "three_quarter", "profile", "full_body"]);
    expect(tiles.filter((tile) => !tile.url).map((tile) => tile.label)).toEqual(["Profile", "Full body"]);
    expect(packHasGap([{ kind: "front", url: "https://s/front.jpg", label: "Front" }])).toBe(true);
  });

  it("calls a complete pack complete", () => {
    const refs = [
      { kind: "front", url: "a", label: "Front" },
      { kind: "three_quarter", url: "b", label: "Three-quarter" },
      { kind: "profile", url: "c", label: "Profile" },
      { kind: "full_body", url: "d", label: "Full body" },
    ];
    expect(packHasGap(refs)).toBe(false);
    expect(packTiles(refs)).toHaveLength(4);
  });

  it("keeps wardrobe looks after the four angles", () => {
    const tiles = packTiles([
      { kind: "front", url: "a", label: "Front" },
      { kind: "look:office", url: "e", label: "Office" },
    ]);
    expect(tiles).toHaveLength(5);
    expect(tiles[4]).toEqual({ kind: "look:office", label: "Office", url: "e" });
  });

  it("offers all four slots on an actor with no stills yet", () => {
    expect(packTiles([]).map((tile) => tile.url)).toEqual([null, null, null, null]);
    expect(packTiles(null)).toHaveLength(4);
  });
});
