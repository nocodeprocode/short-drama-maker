import { describe, expect, it } from "vitest";
import { queueVisibleAt, shotNeedsVideo } from "./queue-policy.ts";

describe("queue policy", () => {
  it("does not ask for another generate_video while a video job is already active", () => {
    const shot = { id: "shot-1", status: "generating" };
    expect(
      shotNeedsVideo(shot, [{ shot_id: "shot-1", job_type: "video", status: "queued" }]),
    ).toBe(false);
    expect(
      shotNeedsVideo(shot, [{ shot_id: "shot-1", job_type: "video", status: "generating" }]),
    ).toBe(false);
    expect(shotNeedsVideo(shot, [])).toBe(true);
    expect(shotNeedsVideo({ id: "shot-1", status: "audio_ready" }, [])).toBe(true);
    expect(shotNeedsVideo({ id: "shot-1", status: "complete" }, [])).toBe(false);
    expect(shotNeedsVideo({ id: "shot-1", status: "needs_review" }, [])).toBe(false);
    expect(shotNeedsVideo({ id: "shot-1", status: "complete" }, [], { hasTake: false })).toBe(true);
    expect(
      shotNeedsVideo(
        { id: "shot-1", status: "complete" },
        [{ shot_id: "shot-1", job_type: "video", status: "generating" }],
        { hasTake: false },
      ),
    ).toBe(false);
  });

  it("makes unsubmitted jobs visible immediately", () => {
    expect(
      queueVisibleAt({
        upstream_job_id: null,
        expected_ready_at: "2026-08-31T00:02:00.000Z",
        created_at: "2026-08-31T00:00:00.000Z",
      }),
    ).toBe("2026-08-31T00:00:00.000Z");
    expect(
      queueVisibleAt({
        upstream_job_id: "orv_1",
        expected_ready_at: "2026-08-31T00:02:00.000Z",
        created_at: "2026-08-31T00:00:00.000Z",
      }),
    ).toBe("2026-08-31T00:02:00.000Z");
  });
});
