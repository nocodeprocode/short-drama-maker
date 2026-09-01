import { describe, expect, it } from "vitest";
import type { GenerationJob } from "../domain.ts";
import { canTransition, IllegalJobTransitionError, isTerminal, transitionJob } from "./state-machine.ts";

function job(status: GenerationJob["status"]): GenerationJob {
  return {
    id: "j1",
    owner_id: "u1",
    series_id: "s1",
    episode_id: null,
    scene_id: null,
    shot_id: null,
    job_type: "video",
    model: "bytedance/seedance-2.0",
    provider: "openrouter",
    upstream_job_id: null,
    callback_token: "tok",
    callback_token_used: false,
    idempotency_key: "k",
    status,
    request_metadata: {},
    result_metadata: {},
    estimated_cost: 1,
    actual_cost: null,
    attempt: 1,
    error_code: null,
    created_at: "t",
    updated_at: "t",
    expected_ready_at: "t",
  };
}

describe("job state machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("queued", "submitting")).toBe(true);
    expect(canTransition("submitting", "generating")).toBe(true);
    expect(canTransition("generating", "ingesting")).toBe(true);
    expect(canTransition("ingesting", "qc")).toBe(true);
    expect(canTransition("qc", "completed")).toBe(true);
    expect(canTransition("qc", "needs_review")).toBe(true);
  });

  it("forbids skipping and leaving terminal states", () => {
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("needs_review", "completed")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
    expect(() => transitionJob(job("completed"), "failed", "now")).toThrow(
      IllegalJobTransitionError,
    );
  });

  it("allows a failed sync job to be queued again", () => {
    expect(canTransition("failed", "queued")).toBe(true);
    expect(transitionJob(job("failed"), "queued", "now").status).toBe("queued");
  });

  it("allows fail or cancel from any active state", () => {
    for (const from of ["queued", "submitting", "generating", "ingesting", "qc"] as const) {
      expect(canTransition(from, "failed")).toBe(true);
      expect(canTransition(from, "cancelled")).toBe(true);
    }
  });
});
