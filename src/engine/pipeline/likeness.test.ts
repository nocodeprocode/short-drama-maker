import { describe, expect, it } from "vitest";
import { actorsFromPackedCharacters, likenessGate } from "./likeness.ts";

describe("likeness gate", () => {
  it("rejects a likeness POST without confirmation", () => {
    expect(likenessGate(false)).toEqual({
      ok: false,
      status: 403,
      error: "Likeness rights confirmation is required.",
    });
  });

  it("allows a confirmed likeness request", () => {
    expect(likenessGate(true)).toEqual({ ok: true });
  });
});

describe("actor backfill mapping", () => {
  it("creates one actor per existing packed character", () => {
    expect(
      actorsFromPackedCharacters([
        { id: "c1", name: "Tariq", owner_id: "u1", visual_reference_asset_ids: { front: "a1", profile: "a2" } },
        { id: "c2", name: "Empty", owner_id: "u1", visual_reference_asset_ids: {} },
        { id: "c3", name: "Linked", owner_id: "u1", actor_id: "existing", visual_reference_asset_ids: { front: "x" } },
      ]),
    ).toEqual([
      { character_id: "c1", owner_id: "u1", name: "Tariq", refs: { front: "a1", profile: "a2" } },
    ]);
  });
});
