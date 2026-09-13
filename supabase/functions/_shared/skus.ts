export const SEASON_SKUS = [2, 12, 15, 24, 30, 45, 50, 60, 90] as const;
export type CatalogSku = (typeof SEASON_SKUS)[number] | "topup" | "credit";
export type BlockSku = (typeof SEASON_SKUS)[number];
export type ProductionPriority = "fast" | "balanced" | "quality";
export type EpisodeLength = "30_45" | "45_60" | "60_90" | "120_180" | "900_1080";
export type VideoTier = "pro" | "catalog";

export const SEASON_PRICES_USD: Record<Exclude<CatalogSku, "credit">, number> = {
  2: 76,
  12: 433,
  15: 542,
  24: 821,
  30: 1026,
  45: 1436,
  50: 1596,
  60: 1824,
  90: 2736,
  topup: 49,
};

export const CREDIT_PRESETS = [49, 100, 250, 500, 1000] as const;

export const PRIORITY_RATES_USD: Record<ProductionPriority, number> = {
  fast: 24,
  balanced: 38,
  quality: 62,
};

/** Catalog picture (Seedance 2.0 mini) vs Pro (2.5). Conservative COGS cut, not a second price book. */
export const PICTURE_FACTOR: Record<VideoTier, number> = {
  pro: 1,
  catalog: 0.75,
};

/** Must match LENGTH_FACTOR in src/engine/config/skus.ts. Guarded by src/lib/pricing-parity.test.ts. */
export const LENGTH_FACTOR: Record<EpisodeLength, number> = {
  "30_45": 0.6,
  "45_60": 0.7,
  "60_90": 1,
  "120_180": 2,
  "900_1080": 15,
};

export const LENGTH_LABEL: Record<EpisodeLength, string> = {
  "30_45": "30 to 45 sec",
  "45_60": "60 sec",
  "60_90": "90 sec",
  "120_180": "120 sec",
  "900_1080": "15 min",
};

/**
 * Must equal LENGTH_BUDGETS[length].target_episode_seconds in
 * src/drama-engine/types/pacing.ts. Deno cannot import from src/, so
 * src/lib/pricing-parity.test.ts guards the copy.
 */
export const SECONDS_PER_EPISODE: Record<EpisodeLength, number> = {
  "30_45": 38,
  "45_60": 60,
  "60_90": 90,
  "120_180": 120,
  "900_1080": 900,
};

export function isSeasonSku(value: unknown): value is BlockSku {
  return SEASON_SKUS.includes(Number(value) as BlockSku);
}

export const isBlockSku = isSeasonSku;

export function isCatalogSku(value: unknown): value is CatalogSku {
  return value === "topup" || value === "credit" || isSeasonSku(value);
}

export function isPriority(value: unknown): value is ProductionPriority {
  return value === "fast" || value === "balanced" || value === "quality";
}

export function isEpisodeLength(value: unknown): value is EpisodeLength {
  return value === "30_45" || value === "45_60" || value === "60_90" || value === "120_180" || value === "900_1080";
}

export function isVideoTier(value: unknown): value is VideoTier {
  return value === "pro" || value === "catalog";
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
  return Math.round(
    PRIORITY_RATES_USD[priority] *
      LENGTH_FACTOR[length] *
      PICTURE_FACTOR[videoTier] *
      sku *
      volumeDiscount(sku),
  );
}

export function estimateSeries(episodeCount: BlockSku) {
  const setup = 0.33;
  const generate = 2.4 * episodeCount;
  const estimated_min = Math.round((setup + generate) * 10000) / 10000;
  return {
    episode_count: episodeCount,
    setup,
    generate: Math.round(generate * 10000) / 10000,
    estimated_min,
    estimated_max: Math.round(estimated_min * 1.15 * 10000) / 10000,
    retail: SEASON_PRICES_USD[episodeCount],
  };
}

export function estimateBlock(input: {
  sku: CatalogSku;
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
      finished_runtime_label: "0 min",
      run_minutes: 0,
      run_time_label: "—",
      estimated_min: 0,
      estimated_max: 0,
      retail: input.amount && input.amount > 0 ? Math.round(input.amount) : SEASON_PRICES_USD.topup,
      video_tier: input.video_tier ?? "pro",
      is_pilot: false,
    };
  }
  const sku = input.sku;
  const priority = input.priority ?? "balanced";
  const length = input.length ?? "60_90";
  const videoTier = input.video_tier ?? "pro";
  const cogs = estimateSeries(sku);
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
    estimated_max: cogs.estimated_max,
    retail: retailForBlock(sku, priority, length, videoTier),
    video_tier: videoTier,
    is_pilot: sku === 2,
  };
}

export function nextEpisodeRange(existingCount: number, sku: BlockSku) {
  const start = Math.max(1, existingCount + 1);
  return { start, end: start + sku - 1 };
}

export function posterTone(seed: string): string {
  const tones = ["g1", "g2", "g3", "g4", "g5", "g6"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length]!;
}
