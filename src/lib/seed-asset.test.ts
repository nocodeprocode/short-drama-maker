import { describe, expect, it } from "vitest";
import { pickLatestSeedId } from "../../supabase/functions/_shared/seed-asset.ts";

describe("pickLatestSeedId", () => {
  it("returns the newest seed photo and ignores generated stills", () => {
    expect(
      pickLatestSeedId([
        { id: "front-1", metadata: { kind: "front" }, created_at: "2026-09-13T12:10:00.000Z" },
        { id: "seed-old", metadata: { kind: "seed" }, created_at: "2026-09-13T11:00:00.000Z" },
        { id: "seed-new", metadata: { kind: "seed" }, created_at: "2026-09-13T12:05:00.000Z" },
      ]),
    ).toBe("seed-new");
  });

  it("returns null when no seed photo exists", () => {
    expect(pickLatestSeedId([{ id: "front-1", metadata: { kind: "front" }, created_at: "2026-09-13T12:00:00.000Z" }])).toBeNull();
  });
});
