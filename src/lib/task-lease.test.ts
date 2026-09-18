import { describe, expect, it } from "vitest";
import { TASK_HEARTBEAT_MS, TASK_LEASE_SECONDS } from "../engine/jobs/runner.ts";

/**
 * A worker died holding a five-minute lease on an actor pack, having written
 * neither an image nor an error, and nothing could retry until the lease aged
 * out. The user watched a card sit at 0/4 for five and a half minutes. The lease
 * is only useful as a liveness signal, so it has to stay a small multiple of the
 * heartbeat that renews it.
 */
describe("task lease", () => {
  it("is renewed several times before it can expire", () => {
    const heartbeatSeconds = TASK_HEARTBEAT_MS / 1000;
    expect(TASK_LEASE_SECONDS / heartbeatSeconds).toBeGreaterThanOrEqual(3);
  });

  it("recovers a dead claim in well under the old five minutes", () => {
    expect(TASK_LEASE_SECONDS).toBeLessThanOrEqual(120);
  });

  it("leaves a healthy worker enough slack to miss a heartbeat", () => {
    expect(TASK_LEASE_SECONDS * 1000).toBeGreaterThan(TASK_HEARTBEAT_MS * 2);
  });

  it("stays inside what extend_engine_task_lease will grant", () => {
    // The RPC clamps to [30, 1800] seconds; a lease outside that silently becomes
    // a different number than the runner thinks it holds.
    expect(TASK_LEASE_SECONDS).toBeGreaterThanOrEqual(30);
    expect(TASK_LEASE_SECONDS).toBeLessThanOrEqual(1800);
  });
});
