import { describe, expect, it } from "vitest";
import { presentActor } from "../../supabase/functions/_shared/actors.ts";

describe("actor generation presentation", () => {
  it("shows dead-lettered generation as failed instead of an idle zero-progress pack", () => {
    const actor = presentActor(
      {
        id: "actor-1",
        name: "Actor",
        source: "likeness",
        visual_reference_asset_ids: {},
        appearance_profile: {},
        created_at: "2026-09-13T00:00:00Z",
      },
      new Map(),
      {
        task: {
          actor_id: "actor-1",
          status: "dead_lettered",
          error: "CAST_LOOK: production_gear",
        },
      },
    );

    expect(actor.status).toBe("failed");
    expect(actor.error).toMatch(/production_gear/);
  });
});
