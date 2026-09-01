import { describe, expect, it } from "vitest";
import type { Asset, GenerationJob, Series } from "../domain.ts";
import { planRetention } from "./retention.ts";

function asset(partial: Partial<Asset> & Pick<Asset, "id">): Asset {
  return {
    owner_id: "u",
    series_id: "s1",
    kind: "shot_video",
    bucket: "private-generation",
    storage_path: partial.id,
    mime_type: "video/mp4",
    bytes: 8,
    checksum: partial.id,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    ...partial,
  };
}

describe("asset retention", () => {
  it("keeps the selected generation plus the last two candidates", () => {
    const assets = [
      asset({ id: "sel", created_at: "2026-01-01T00:00:00.000Z", metadata: { shot_id: "sh" } }),
      asset({ id: "old", created_at: "2026-01-02T00:00:00.000Z", metadata: { shot_id: "sh" } }),
      asset({ id: "c1", created_at: "2026-01-03T00:00:00.000Z", metadata: { shot_id: "sh" } }),
      asset({ id: "c2", created_at: "2026-01-04T00:00:00.000Z", metadata: { shot_id: "sh" } }),
    ];
    const actions = planRetention({
      now: new Date("2026-01-05T00:00:00.000Z"),
      series: [],
      assets,
      jobs: [],
      selectedAssetIds: new Set(["sel"]),
    });
    expect(actions.map((action) => action.asset_id)).toContain("old");
    expect(actions.map((action) => action.asset_id)).not.toContain("sel");
    expect(actions.map((action) => action.asset_id)).not.toContain("c2");
  });

  it("purges failed generations after 7 days", () => {
    const actions = planRetention({
      now: new Date("2026-01-10T00:00:00.000Z"),
      series: [],
      assets: [
        asset({
          id: "fail",
          created_at: "2026-01-01T00:00:00.000Z",
          metadata: { generation_job_id: "j1", shot_id: "sh" },
        }),
      ],
      jobs: [{ id: "j1", status: "failed" } as GenerationJob],
      selectedAssetIds: new Set(),
    });
    expect(actions[0]).toMatchObject({ asset_id: "fail", reason: "failed_generation" });
  });

  it("purges a soft-deleted series after 30 days", () => {
    const actions = planRetention({
      now: new Date("2026-03-02T00:00:00.000Z"),
      series: [{ id: "s1", deleted_at: "2026-01-01T00:00:00.000Z" } as Series],
      assets: [asset({ id: "gone" })],
      jobs: [],
      selectedAssetIds: new Set(),
    });
    expect(actions[0]?.reason).toBe("soft_deleted_series");
  });
});
