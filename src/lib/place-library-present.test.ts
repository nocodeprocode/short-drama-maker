import { describe, expect, it } from "vitest";
import { presentLocationEntry } from "../../supabase/functions/_shared/library.ts";

describe("place library presenter", () => {
  it("includes every generated room angle in the catalog response", () => {
    const row = presentLocationEntry(
      {
        id: "place-1",
        owner_id: "user-1",
        name: "boardroom",
        source: "generated",
        notes: "",
        tags: [],
        plate_asset_id: "plate-1",
        seed_asset_id: null,
        lighting_lock: null,
        status: "ready",
        error: null,
        created_at: "2026-09-13T00:00:00.000Z",
      },
      {
        image_url: "https://media/master",
        angles: [
          { angle: "facing", url: "https://media/facing" },
          { angle: "opposite", url: "https://media/opposite" },
          { angle: "left", url: "https://media/left" },
          { angle: "right", url: "https://media/right" },
          { angle: "overhead", url: "https://media/overhead" },
        ],
      },
    );

    expect(row.angles).toHaveLength(5);
    expect(row.angles.map((angle) => angle.angle)).toEqual(["facing", "opposite", "left", "right", "overhead"]);
  });
});
