import { DRAFT_TTL_DAYS } from "./config/models.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export { DRAFT_TTL_DAYS };

export function seriesHasPaidRun(
  productions: ReadonlyArray<{ paid_amount?: number | string | null; status?: string | null }>,
) {
  return productions.some((row) => Number(row.paid_amount ?? 0) > 0);
}

export function canDiscardSeries(
  productions: ReadonlyArray<{ paid_amount?: number | string | null; status?: string | null }>,
) {
  return !seriesHasPaidRun(productions);
}

export function draftExpiresAt(createdAt: string) {
  return new Date(Date.parse(createdAt) + DRAFT_TTL_DAYS * DAY_MS);
}

export function draftIsExpired(createdAt: string, now = new Date()) {
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return false;
  return now.getTime() >= start + DRAFT_TTL_DAYS * DAY_MS;
}

export function unpaidDraftProduction(
  productions: ReadonlyArray<{ id: string; status: string; paid_amount?: number | string | null }>,
) {
  return (
    productions.find(
      (row) => row.status === "awaiting_payment" && Number(row.paid_amount ?? 0) <= 0,
    ) ?? null
  );
}
