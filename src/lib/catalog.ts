import {
  SECONDS_PER_EPISODE,
  isBlockSku,
  isEpisodeLength,
  retailForBlock,
  type EpisodeLength,
  type ProductionPriority,
} from "@/engine/config/catalog.ts";

export const PRIMARY_SKUS = [15, 30, 45, 60, 90] as const;
export const CONTINUATION_SKUS = [15, 30, 45, 60, 90] as const;
export const PILOT_SKU = 2;
export const BLOCK_SKUS = [15, 30, 45, 60, 90] as const;
export const CATALOG_SKUS = [2, 12, 15, 24, 30, 45, 50, 60, 90] as const;
export const CREDIT_PRESETS = [49, 100, 250, 500, 1000] as const;

export const COMMISSION_SKUS = [15, 30, 45, 60, 90] as const;
export const COMMISSION_LENGTHS = ["45_60", "60_90", "120_180"] as const;
export const DEFAULT_COMMISSION_SKU = 30;
export const DEFAULT_COMMISSION_LENGTH = "60_90";
/** Stripe will not take a load under this, so a tiny gap rounds up to it. */
export const MIN_WALLET_LOAD = 10;

/** The gap, to the dollar. The quote is the price; we never upsell a preset. */
export function gapCharge(shortfall: number) {
  return Math.max(MIN_WALLET_LOAD, Math.ceil(shortfall));
}

export type CommissionSku = (typeof COMMISSION_SKUS)[number];
export type CommissionLength = (typeof COMMISSION_LENGTHS)[number];

export function isCommissionSku(value: unknown): value is CommissionSku {
  return COMMISSION_SKUS.includes(Number(value) as CommissionSku);
}

export function isCommissionLength(value: unknown): value is CommissionLength {
  return COMMISSION_LENGTHS.includes(value as CommissionLength);
}

export function commissionSku(value: number | string | null | undefined): CommissionSku {
  const count = Number(value);
  if (isCommissionSku(count)) return count;
  if (count >= 90) return 90;
  if (count >= 60) return 60;
  if (count >= 45) return 45;
  if (count >= 30) return 30;
  return 15;
}

export function commissionLength(value: string | null | undefined): CommissionLength {
  if (isCommissionLength(value)) return value;
  if (value === "900_1080") return "120_180";
  return DEFAULT_COMMISSION_LENGTH;
}

export type VideoTier = "pro" | "catalog";
export type { EpisodeLength, ProductionPriority };

/** One price book. The engine owns the rates; the client never keeps its own copy. */
export function retailFor(
  sku: number,
  priority: ProductionPriority = "balanced",
  length: string = "60_90",
  videoTier: VideoTier = "pro",
) {
  if (!isBlockSku(sku) || !isEpisodeLength(length)) return 0;
  return retailForBlock(sku, priority, length, videoTier);
}

export function episodeSeconds(length: string = "60_90") {
  return isEpisodeLength(length) ? SECONDS_PER_EPISODE[length] : SECONDS_PER_EPISODE["60_90"];
}

export function finishedRuntimeSeconds(sku: number, length: string = "60_90") {
  if (!Number.isFinite(sku) || sku <= 0) return 0;
  return episodeSeconds(length) * sku;
}

export function runtimeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  // Episode length is sold in seconds through 120. Rounding 90s or 120s to
  // "2 min" would make the three options collide.
  if (seconds <= 120) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  // Feature-length short dramas are sold in minutes (30 / 45 / 60 / 90).
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function finishedRuntimeLabel(sku: number, length: string = "60_90") {
  return runtimeLabel(finishedRuntimeSeconds(sku, length));
}

export function skuLabel(sku: number | string) {
  if (sku === "topup" || sku === "credit") return "Studio credit";
  const count = Number(sku);
  if (count === 2) return "2-episode pilot";
  if (Number.isFinite(count) && count > 0) return `${count} episodes`;
  return "Episode block";
}
