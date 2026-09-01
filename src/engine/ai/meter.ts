/**
 * Provider cost meter. Every gateway call records what the provider said it
 * cost (or a usage-based figure when the provider reports usage but not
 * price). The engine drains the meter when it settles a job so the ledger
 * carries real spend instead of the flat per-call estimates in models.ts.
 */
export type MeterEntry = {
  provider: string;
  kind: string;
  usd: number;
  /** Raw usage the figure came from (tokens, characters, seconds). */
  usage?: Record<string, number>;
  /** True when `usd` is the provider's own number, false when derived from usage. */
  reported: boolean;
};

export type CostMeter = {
  record(entry: MeterEntry): void;
  /** Returns the total since the last take and clears it. */
  take(): { usd: number; entries: MeterEntry[] };
  /** Current total without clearing. */
  peek(): number;
};

export function createCostMeter(): CostMeter {
  let entries: MeterEntry[] = [];
  return {
    record(entry) {
      if (!Number.isFinite(entry.usd) || entry.usd < 0) return;
      entries.push({ ...entry, usd: Math.round(entry.usd * 1_000_000) / 1_000_000 });
    },
    take() {
      const taken = entries;
      entries = [];
      const usd = Math.round(taken.reduce((sum, row) => sum + row.usd, 0) * 10_000) / 10_000;
      return { usd, entries: taken };
    },
    peek() {
      return Math.round(entries.reduce((sum, row) => sum + row.usd, 0) * 10_000) / 10_000;
    },
  };
}

/** Process-wide meter the provider modules write to; the gateway exposes it. */
export const costMeter = createCostMeter();

/** OpenRouter returns `usage.cost` in USD when the request asks for usage accounting. */
export function openRouterUsageCost(
  usage: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
  fallbackUsd: number,
  kind: string,
): MeterEntry {
  const reported = typeof usage?.cost === "number" && Number.isFinite(usage.cost);
  return {
    provider: "openrouter",
    kind,
    usd: reported ? usage!.cost! : fallbackUsd,
    usage: usage
      ? {
          ...(usage.prompt_tokens != null ? { prompt_tokens: usage.prompt_tokens } : {}),
          ...(usage.completion_tokens != null ? { completion_tokens: usage.completion_tokens } : {}),
        }
      : undefined,
    reported,
  };
}
