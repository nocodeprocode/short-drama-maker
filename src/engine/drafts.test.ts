import { describe, expect, it } from "vitest";
import { canDiscardSeries, draftIsExpired, unpaidDraftProduction } from "./drafts.ts";

describe("unpaid drafts", () => {
  it("lets a never-paid show be discarded", () => {
    expect(canDiscardSeries([])).toBe(true);
    expect(canDiscardSeries([{ status: "awaiting_payment", paid_amount: 0 }])).toBe(true);
    expect(canDiscardSeries([{ status: "cancelled", paid_amount: 0 }])).toBe(true);
    expect(canDiscardSeries([{ status: "running", paid_amount: 1026 }])).toBe(false);
  });

  it("expires a draft after 14 days", () => {
    expect(draftIsExpired("2026-08-01T00:00:00.000Z", new Date("2026-08-14T00:00:00.000Z"))).toBe(false);
    expect(draftIsExpired("2026-08-01T00:00:00.000Z", new Date("2026-08-15T00:00:00.000Z"))).toBe(true);
  });

  it("points continue at the unpaid production", () => {
    expect(
      unpaidDraftProduction([
        { id: "paid", status: "running", paid_amount: 76 },
        { id: "open", status: "awaiting_payment", paid_amount: 0 },
      ])?.id,
    ).toBe("open");
  });
});
