import { afterEach, describe, expect, it } from "vitest";
import { clearCache, readCache, writeCache } from "./cache.ts";

afterEach(() => {
  clearCache();
});

describe("studio cache", () => {
  it("returns null for a missing key", () => {
    expect(readCache("missing")).toBeNull();
  });

  it("round-trips JSON values", () => {
    writeCache("home", { title: "The Night Ledger" });
    expect(readCache<{ title: string }>("home")).toEqual({ title: "The Night Ledger" });
  });

  it("clears every cached key", () => {
    writeCache("a", 1);
    writeCache("b", 2);
    clearCache();
    expect(readCache("a")).toBeNull();
    expect(readCache("b")).toBeNull();
  });
});
