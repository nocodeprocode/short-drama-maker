import { roundMoney } from "../ai/pricing.ts";
import { estimateSeries, SEASON_PRICES_USD, type CatalogSku } from "./skus.ts";
import type { SeasonSku } from "../domain.ts";

export const BLOCK_SKUS = [2, 12, 24, 45, 60] as const;
export type BlockSku = (typeof BLOCK_SKUS)[number];
export type ProductionPriority = "fast" | "balanced" | "quality";
export type EpisodeLength = "30_45" | "60_90" | "120_180" | "900_1080";

export const PRIORITY_RATES_USD: Record<ProductionPriority, number> = {
  fast: 24,
  balanced: 38,
  quality: 62,
};

/**
 * Retail multiplier vs the 60s SKU.
 * 15 min of locked-take picture is 15× a 60s episode — not 1.9×.
 * COGS scales by finished seconds (900/75 = 12× video vs the 60s retail estimate).
 */
export const LENGTH_FACTOR: Record<EpisodeLength, number> = {
  "30_45": 0.6,
  "60_90": 1,
  "120_180": 1.9,
  "900_1080": 15,
};

export const LENGTH_LABEL: Record<EpisodeLength, string> = {
  "30_45": "30 to 45 sec",
  "60_90": "60 to 90 sec",
  "120_180": "2 to 3 min",
  "900_1080": "15 min",
};

export const SECONDS_PER_EPISODE: Record<EpisodeLength, number> = {
  "30_45": 38,
  "60_90": 75,
  "120_180": 150,
  "900_1080": 900,
};

/** Planner craft target (not the retail runtime estimate). */
export const PLANNER_SECONDS: Record<EpisodeLength, number> = {
  "30_45": 38,
  "60_90": 60,
  "120_180": 120,
  "900_1080": 900,
};

export function isEpisodeLength(value: unknown): value is EpisodeLength {
  return value === "30_45" || value === "60_90" || value === "120_180" || value === "900_1080";
}

export function isLongFormLength(length: EpisodeLength | null | undefined): boolean {
  return length === "900_1080";
}

export function episodeLengthFromProfile(profile: Record<string, unknown> | null | undefined): EpisodeLength {
  const raw = profile?.episode_length;
  return isEpisodeLength(raw) ? raw : "60_90";
}

export function isBlockSku(value: unknown): value is BlockSku {
  return BLOCK_SKUS.includes(Number(value) as BlockSku);
}

export function volumeDiscount(episodes: number): number {
  if (episodes >= 60) return 0.8;
  if (episodes >= 45) return 0.84;
  if (episodes >= 24) return 0.9;
  if (episodes >= 12) return 0.95;
  return 1;
}

export function retailForBlock(
  sku: BlockSku,
  priority: ProductionPriority = "balanced",
  length: EpisodeLength = "60_90",
): number {
  const raw = PRIORITY_RATES_USD[priority] * LENGTH_FACTOR[length] * sku * volumeDiscount(sku);
  return Math.round(raw);
}

export function estimateBlock(input: {
  sku: BlockSku | "topup";
  priority?: ProductionPriority;
  length?: EpisodeLength;
}) {
  if (input.sku === "topup") {
    return {
      sku: "topup" as const,
      episode_count: 0,
      priority: input.priority ?? "balanced",
      length: input.length ?? "60_90",
      finished_runtime_seconds: 0,
      run_minutes: 0,
      estimated_min: 0,
      estimated_max: 0,
      retail: SEASON_PRICES_USD.topup,
    };
  }
  const sku = input.sku;
  const priority = input.priority ?? "balanced";
  const length = input.length ?? "60_90";
  const cogs = estimateSeries({ episode_count: sku, length });
  const retail = retailForBlock(sku, priority, length);
  const finished = sku * SECONDS_PER_EPISODE[length];
  const runMinutes = Math.round((sku * 18) / Math.min(sku, 8));
  return {
    sku,
    episode_count: sku,
    priority,
    length,
    length_label: LENGTH_LABEL[length],
    finished_runtime_seconds: finished,
    finished_runtime_label: finished >= 60 ? `${Math.round(finished / 60)} min` : `${finished} sec`,
    run_minutes: runMinutes,
    run_time_label: runMinutes >= 60 ? `~${(runMinutes / 60).toFixed(1)} h` : `~${runMinutes} min`,
    estimated_min: cogs.estimated_min,
    estimated_max: roundMoney(cogs.estimated_max),
    retail,
    is_pilot: sku === 2,
  };
}

export function nextEpisodeRange(
  existingCount: number,
  sku: BlockSku,
): { start: number; end: number } {
  const start = Math.max(1, existingCount + 1);
  return { start, end: start + sku - 1 };
}

export function posterTone(seed: string): string {
  const tones = ["g1", "g2", "g3", "g4", "g5", "g6"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length]!;
}

export function uiPhaseForStatus(status: string): string {
  if (status === "needs_user") return "needs_you";
  if (status === "ready") return "ready";
  if (status === "failed" || status === "cancelled") return "needs_you";
  return "preparing";
}

export type { CatalogSku, SeasonSku };
