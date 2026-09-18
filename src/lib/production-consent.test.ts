import { describe, expect, it } from "vitest";
import { hasExplicitStartConfirmation } from "../../supabase/functions/_shared/production-consent.ts";
import { productionTaskMayRun } from "@/engine/jobs/queue-policy.ts";

describe("production consent boundary", () => {
  it("requires the explicit final-start flag", () => {
    expect(hasExplicitStartConfirmation({})).toBe(false);
    expect(hasExplicitStartConfirmation({ start_confirmed: false })).toBe(false);
    expect(hasExplicitStartConfirmation({ start_confirmed: "true" })).toBe(false);
    expect(hasExplicitStartConfirmation({ start_confirmed: true })).toBe(true);
  });

  it("does not run production work before funded activation", () => {
    expect(productionTaskMayRun({ status: "awaiting_payment", paid_amount: 0, paused: false })).toBe(false);
    expect(productionTaskMayRun({ status: "queued", paid_amount: 0, paused: false })).toBe(false);
    expect(productionTaskMayRun({ status: "queued", paid_amount: 25, paused: false })).toBe(true);
  });
});
