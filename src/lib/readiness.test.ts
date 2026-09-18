import { describe, expect, it } from "vitest";
import { seriesReadiness } from "./series-readiness.ts";

/**
 * This rule decides whether a buyer is allowed to pay, so it has to be wrong in
 * neither direction: never charge for a show that will invent a face or a room
 * mid-run, and never hold back a show that is genuinely ready.
 */

type Rows = {
  series_cast?: Array<Record<string, unknown>>;
  series_locations?: Array<Record<string, unknown>>;
  series_props?: Array<Record<string, unknown>>;
  characters?: Array<Record<string, unknown>>;
  actors?: Array<Record<string, unknown>>;
};

/** Enough of the query builder for the shapes `seriesReadiness` actually uses. */
function fakeClient(rows: Rows) {
  const available: Rows = { characters: [{ id: "char-1", locked: false }], ...rows };
  return {
    from(table: keyof Rows) {
      const data = available[table] ?? [];
      const result = { data, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => result,
        then: (resolve: (value: typeof result) => unknown) => resolve(result),
      };
      return builder;
    },
  } as never;
}

const FACED_ACTOR = { id: "actor-1", visual_reference_asset_ids: { front: "asset-1" } };
const EMPTY_ACTOR = { id: "actor-2", visual_reference_asset_ids: {} };

function speakingSlot(over: Record<string, unknown> = {}) {
  return {
    id: "slot-1",
    job: "engine",
    archetype: "ruthless heir",
    castable: true,
    actor_id: "actor-1",
    character_id: "char-1",
    role_name: "Mara",
    suggested_name: null,
    suggested_gender: "woman",
    ...over,
  };
}

describe("seriesReadiness", () => {
  it("does not treat deleted cast and places as a ready empty show", async () => {
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [],
        series_locations: [],
        series_props: [],
      }),
      "series-1",
    );
    expect(ready.can_start).toBe(false);
    expect(ready.blocking).toEqual([
      "Cast has not been created yet",
      "No places have been prepared yet",
    ]);
  });

  it("lets a show start when every face, place and object exists", async () => {
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot()],
        actors: [FACED_ACTOR],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2", locked: false }],
        series_props: [{ name: "leaked NDA", still_asset_id: "asset-3", locked: false }],
      }),
      "series-1",
    );
    expect(ready.can_start).toBe(true);
    expect(ready.blocking).toEqual([]);
    expect(ready.cast).toMatchObject({ done: 1, total: 1 });
  });

  it("holds a part whose actor has no stills yet", async () => {
    // The actor row exists, so a naive check would pass. Starting here shoots a
    // character with no face.
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot({ actor_id: "actor-2" })],
        actors: [EMPTY_ACTOR],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2" }],
      }),
      "series-1",
    );
    expect(ready.can_start).toBe(false);
    expect(ready.cast).toMatchObject({ done: 0, total: 1 });
    expect(ready.blocking[0]).toContain("Mara");
  });

  it("holds a slot whose character was deleted even if its old actor still has a face", async () => {
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot()],
        characters: [],
        actors: [FACED_ACTOR],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2" }],
      }),
      "series-1",
    );
    expect(ready.can_start).toBe(false);
    expect(ready.cast).toMatchObject({ done: 0, total: 1, missing: ["Mara"] });
  });

  it("does not demand a face for a story device", async () => {
    // A leaked NDA is an object. It is approved on the design sheet, so asking
    // for a face here would make the show unstartable for ever.
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [
          speakingSlot(),
          { ...speakingSlot({ id: "slot-2", job: "nuke", archetype: "leaked NDA", role_name: null }), castable: false, actor_id: null },
        ],
        actors: [FACED_ACTOR],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2" }],
        series_props: [{ name: "leaked NDA", still_asset_id: "asset-3" }],
      }),
      "series-1",
    );
    expect(ready.cast).toMatchObject({ done: 1, total: 1 });
    expect(ready.can_start).toBe(true);
  });

  it("names the places and objects that are still missing", async () => {
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot()],
        actors: [FACED_ACTOR],
        series_locations: [
          { name: "penthouse", plate_asset_id: "asset-2" },
          { name: "black car", plate_asset_id: null },
        ],
        series_props: [{ name: "ring box", still_asset_id: null }],
      }),
      "series-1",
    );
    expect(ready.can_start).toBe(false);
    expect(ready.places).toMatchObject({ done: 1, total: 2, missing: ["black car"] });
    expect(ready.objects).toMatchObject({ done: 0, total: 1, missing: ["ring box"] });
    expect(ready.blocking.join(" ")).toContain("black car");
    expect(ready.blocking.join(" ")).toContain("ring box");
  });

  it("counts a part that has already been shot as cast", async () => {
    // Its character is locked, so the face is in footage whatever the slot says.
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot({ actor_id: null, character_id: "char-1" })],
        characters: [{ id: "char-1", locked: true }],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2" }],
      }),
      "series-1",
    );
    expect(ready.cast).toMatchObject({ done: 1, total: 1 });
    expect(ready.can_start).toBe(true);
  });

  it("reports a part with no name or gender, because no face can be built for it", async () => {
    const ready = await seriesReadiness(
      fakeClient({
        series_cast: [speakingSlot({ actor_id: null, role_name: null, suggested_name: null, suggested_gender: null, archetype: "the rival" })],
        series_locations: [{ name: "penthouse", plate_asset_id: "asset-2" }],
      }),
      "series-1",
    );
    expect(ready.unnamed).toBe(1);
    expect(ready.can_start).toBe(false);
  });
});
