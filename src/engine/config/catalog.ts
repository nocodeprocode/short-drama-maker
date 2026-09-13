import { LENGTH_BUDGETS } from "../../drama-engine/types/pacing.ts";
import { roundMoney } from "../ai/pricing.ts";
import {
  estimateSeries,
  LENGTH_FACTOR,
  PICTURE_FACTOR,
  SEASON_PRICES_USD,
  isVideoTier,
  type CatalogSku,
  type EpisodeLength,
  type VideoTier,
} from "./skus.ts";
import type { SeasonSku } from "../domain.ts";

export const BLOCK_SKUS = [2, 12, 15, 24, 30, 45, 50, 60, 90] as const;
export type BlockSku = (typeof BLOCK_SKUS)[number];
export type ProductionPriority = "fast" | "balanced" | "quality";
export type { EpisodeLength };
export { LENGTH_FACTOR };

export const PRIORITY_RATES_USD: Record<ProductionPriority, number> = {
  fast: 24,
  balanced: 38,
  quality: 62,
};

export const LENGTH_LABEL: Record<EpisodeLength, string> = {
  "30_45": "30 to 45 sec",
  "45_60": "60 sec",
  "60_90": "90 sec",
  "120_180": "120 sec",
  "900_1080": "15 min",
};

/**
 * Runtime we quote the buyer. Derived from what the planner actually shoots so the
 * minutes on the order summary are the minutes that get delivered.
 */
export const SECONDS_PER_EPISODE: Record<EpisodeLength, number> = {
  "30_45": LENGTH_BUDGETS["30_45"].target_episode_seconds,
  "45_60": LENGTH_BUDGETS["45_60"].target_episode_seconds,
  "60_90": LENGTH_BUDGETS["60_90"].target_episode_seconds,
  "120_180": LENGTH_BUDGETS["120_180"].target_episode_seconds,
  "900_1080": LENGTH_BUDGETS["900_1080"].target_episode_seconds,
};

export function isEpisodeLength(value: unknown): value is EpisodeLength {
  return value === "30_45" || value === "45_60" || value === "60_90" || value === "120_180" || value === "900_1080";
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
  videoTier: VideoTier = "pro",
): number {
  const raw =
    PRIORITY_RATES_USD[priority] *
    LENGTH_FACTOR[length] *
    PICTURE_FACTOR[videoTier] *
    sku *
    volumeDiscount(sku);
  return Math.round(raw);
}

export function estimateBlock(input: {
  sku: BlockSku | "topup" | "credit";
  priority?: ProductionPriority;
  length?: EpisodeLength;
  video_tier?: VideoTier;
  amount?: number;
}) {
  if (input.sku === "topup" || input.sku === "credit") {
    return {
      sku: input.sku,
      episode_count: 0,
      priority: input.priority ?? "balanced",
      length: input.length ?? "60_90",
      finished_runtime_seconds: 0,
      run_minutes: 0,
      estimated_min: 0,
      estimated_max: 0,
      retail: input.amount && input.amount > 0 ? Math.round(input.amount) : SEASON_PRICES_USD.topup,
      video_tier: input.video_tier ?? "pro",
    };
  }
  const sku = input.sku;
  const priority = input.priority ?? "balanced";
  const length = input.length ?? "60_90";
  const videoTier = input.video_tier ?? "pro";
  const cogs = estimateSeries({ episode_count: sku, length, video_tier: videoTier });
  const retail = retailForBlock(sku, priority, length, videoTier);
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
    video_tier: videoTier,
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

export type { CatalogSku, SeasonSku, VideoTier };
export { PICTURE_FACTOR, isVideoTier };
