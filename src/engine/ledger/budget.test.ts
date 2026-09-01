import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../domain.ts";
import {
  assertCanReserve,
  DailySpendLimitError,
  DuplicateLedgerEntryError,
  InsufficientBudgetError,
  projectBalance,
  reservedForJob,
} from "./budget.ts";

function entry(
  type: LedgerEntry["entry_type"],
  amount: number,
  job: string | null = null,
): LedgerEntry {
  return {
    id: `${type}-${amount}`,
    owner_id: "u",
    series_id: "s",
    entry_type: type,
    amount,
    generation_job_id: job,
    stripe_event_id: null,
    price_snapshot_version: "v1",
    created_at: "t",
  };
}

describe("project budget ledger", () => {
  it("treats purchase as credit and reserve/settle as debit", () => {
    const entries = [entry("purchase", 10), entry("reserve", 3, "j1")];
    expect(projectBalance(entries)).toBe(7);
  });

  it("charges exactly the actual cost once a job settles", () => {
    // reserve 3, actual 2: settle(2) + release(3) leaves 10 - 2.
    const entries = [
      entry("purchase", 10),
      entry("reserve", 3, "j1"),
      entry("settle", 2, "j1"),
      entry("release", 3, "j1"),
    ];
    expect(projectBalance(entries)).toBe(8);
    expect(reservedForJob(entries, "j1")).toBe(0);
  });

  it("charges the overage when actual exceeds the reserve", () => {
    const entries = [
      entry("purchase", 10),
      entry("reserve", 1, "j1"),
      entry("settle", 2.5, "j1"),
      entry("release", 1, "j1"),
    ];
    expect(projectBalance(entries)).toBe(7.5);
  });

  it("blocks jobs past headroom", () => {
    const entries = [entry("purchase", 1)];
    expect(() => assertCanReserve(entries, "j2", 2, 0, 100)).toThrow(
      InsufficientBudgetError,
    );
  });

  it("blocks a second reserve for the same job", () => {
    const entries = [entry("purchase", 10), entry("reserve", 1, "j1")];
    expect(() => assertCanReserve(entries, "j1", 1, 0, 100)).toThrow(
      DuplicateLedgerEntryError,
    );
  });

  it("enforces the daily kill switch independently", () => {
    const entries = [entry("purchase", 100)];
    expect(() => assertCanReserve(entries, "j9", 5, 248, 250)).toThrow(
      DailySpendLimitError,
    );
  });

  it("lets admins skip series budget but not the platform daily cap", () => {
    const entries = [entry("purchase", 1)];
    expect(() =>
      assertCanReserve(entries, "j-admin", 50, 0, 2000, { skipSeriesBudget: true }),
    ).not.toThrow();
    expect(() =>
      assertCanReserve(entries, "j-admin-cap", 50, 1990, 2000, { skipSeriesBudget: true }),
    ).toThrow(DailySpendLimitError);
  });
});
