import type { LedgerEntry, LedgerEntryType } from "../domain.ts";

export const DEFAULT_PRICE_SNAPSHOT_VERSION = "2026-08-31.v1-720p";

export class InsufficientBudgetError extends Error {
  constructor(readonly needed: number, readonly available: number) {
    super(
      `Insufficient project budget: need ${needed.toFixed(4)}, have ${available.toFixed(4)}`,
    );
    this.name = "InsufficientBudgetError";
  }
}

export class DailySpendLimitError extends Error {
  constructor(readonly needed: number, readonly remaining: number) {
    super(
      `Daily provider spend limit reached: need ${needed.toFixed(4)}, remaining ${remaining.toFixed(4)}`,
    );
    this.name = "DailySpendLimitError";
  }
}

export class DuplicateLedgerEntryError extends Error {
  constructor(
    readonly generationJobId: string,
    readonly entryType: LedgerEntryType,
  ) {
    super(`Duplicate ledger ${entryType} for job ${generationJobId}`);
    this.name = "DuplicateLedgerEntryError";
  }
}

export class DuplicateStripeEventError extends Error {
  constructor(readonly stripeEventId: string) {
    super(`Stripe event already applied: ${stripeEventId}`);
    this.name = "DuplicateStripeEventError";
  }
}

/**
 * Ledger semantics (mirrored in supabase/functions/_shared/productions.ts and
 * webhooks-stripe): purchase/release/adjustment credit; reserve/settle debit.
 * A completed job therefore writes `settle(actual)` AND `release(reserved)` so
 * the hold is fully unwound and only the actual cost stays debited.
 */
/** Wallet credit is ledger with no series. Series leftover never mixes into this. */
export function walletBalance(entries: readonly LedgerEntry[]): number {
  return projectBalance(entries.filter((entry) => entry.series_id == null));
}

export function seriesLedgerBalance(entries: readonly LedgerEntry[], seriesId: string): number {
  return projectBalance(entries.filter((entry) => entry.series_id === seriesId));
}

export function canAllocateWallet(available: number, needed: number): boolean {
  return needed <= available + 1e-9;
}

export function walletShortfall(needed: number, available: number): {
  needed: number;
  available: number;
  shortfall: number;
} {
  return {
    needed,
    available,
    shortfall: Math.max(0, Math.round((needed - available) * 100) / 100),
  };
}

export function projectBalance(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, entry) => {
    switch (entry.entry_type) {
      case "purchase":
      case "release":
      case "adjustment":
        return sum + entry.amount;
      case "reserve":
      case "settle":
        return sum - entry.amount;
      default:
        return sum;
    }
  }, 0);
}

export function reservedForJob(
  entries: readonly LedgerEntry[],
  generationJobId: string,
): number {
  return entries
    .filter((entry) => entry.generation_job_id === generationJobId)
    .reduce((sum, entry) => {
      if (entry.entry_type === "reserve") return sum + entry.amount;
      if (entry.entry_type === "release") return sum - entry.amount;
      return sum;
    }, 0);
}

export function hasLedgerPair(
  entries: readonly LedgerEntry[],
  generationJobId: string,
  entryType: "reserve" | "settle" | "release",
): boolean {
  return entries.some(
    (entry) =>
      entry.generation_job_id === generationJobId &&
      entry.entry_type === entryType,
  );
}

export function hasStripeEvent(
  entries: readonly LedgerEntry[],
  stripeEventId: string,
): boolean {
  return entries.some((entry) => entry.stripe_event_id === stripeEventId);
}

export function assertCanReserve(
  entries: readonly LedgerEntry[],
  generationJobId: string,
  amount: number,
  dailySpent: number,
  dailyCap: number,
  options: { skipSeriesBudget?: boolean } = {},
): void {
  if (hasLedgerPair(entries, generationJobId, "reserve")) {
    throw new DuplicateLedgerEntryError(generationJobId, "reserve");
  }

  if (!options.skipSeriesBudget) {
    const available = projectBalance(entries);
    if (amount > available + 1e-9) {
      throw new InsufficientBudgetError(amount, available);
    }
  }

  const remainingDaily = dailyCap - dailySpent;
  if (amount > remainingDaily + 1e-9) {
    throw new DailySpendLimitError(amount, remainingDaily);
  }
}
