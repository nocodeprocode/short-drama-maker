import { LENGTH_BUDGETS } from "../../drama-engine/types/pacing.ts";
import { IMAGE_PRICE, LLM_PRICE, STT_PRICE_PER_MINUTE, VISION_PRICE, VOICE_DESIGN_PRICE } from "./models.ts";
import { pricing, roundMoney } from "../ai/pricing.ts";
import type { SeasonSku } from "../domain.ts";

export const SEASON_SKUS = [2, 12, 15, 24, 30, 45, 50, 60, 90] as const;

export type EpisodeLength = "30_45" | "45_60" | "60_90" | "120_180" | "900_1080";

/**
 * Retail multiplier vs the 60_90 SKU. Longer tiers carry a deliberate premium
 * over pure runtime: they cost more to plan, judge, and conform per finished
 * second, and the buyer is paying for a longer locked-identity take.
 * Price per delivered minute is pinned by a test so the premium stays visible.
 */
export const LENGTH_FACTOR: Record<EpisodeLength, number> = {
  "30_45": 0.6,
  "45_60": 0.7,
  "60_90": 1,
  "120_180": 2,
  "900_1080": 15,
};

export type CatalogSku = SeasonSku | "topup" | "credit";
export type VideoTier = "pro" | "catalog";

/** Catalog picture (Seedance 2.0 mini) vs Pro (2.5). Conservative COGS cut, not a second price book. */
export const PICTURE_FACTOR: Record<VideoTier, number> = {
  pro: 1,
  catalog: 0.75,
};

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

export const WAN_SECONDS_PER_EPISODE = 32;
export const MINI_SECONDS_PER_EPISODE = 20;
export const HERO_SECONDS_PER_EPISODE = 8;
export const DIALOGUE_LINES_PER_EPISODE = 8;
/** Takes per 75s episode (Wan CUs ≈ 5s, mini reactions/wides ≈ 4s, one hero). Each is judged for identity. */
export const TAKES_PER_EPISODE = 12;
/** Dialogue CUs whose native audio gets an STT sample, and the minutes each costs. */
export const STT_SAMPLES_PER_EPISODE = 3;
export const STT_MINUTES_PER_SAMPLE = 0.1;
/** LLM calls to write and shot-plan a short episode; long-form adds an outline plus one call per 3 blocks. */
export const LLM_CALLS_PER_EPISODE = 2;
export const LLM_CALLS_PER_LONG_EPISODE = 2 + 1 + Math.ceil(15 / 3);
/** Dropped takes (stranger, second body, sheer, morph) that are regenerated automatically. */
export const REGEN_BUFFER = 1.25;

export function isSeasonSku(value: unknown): value is SeasonSku {
  return SEASON_SKUS.includes(Number(value) as SeasonSku);
}

export function isCatalogSku(value: unknown): value is CatalogSku {
  return value === "topup" || value === "credit" || isSeasonSku(value);
}

export function isVideoTier(value: unknown): value is VideoTier {
  return value === "pro" || value === "catalog";
}

export function estimateSeries(input: {
  episode_count: SeasonSku;
  character_count?: number;
  length?: EpisodeLength;
  video_tier?: VideoTier;
}): {
  episode_count: SeasonSku;
  setup: number;
  generate: number;
  estimated_min: number;
  estimated_max: number;
  retail: number;
} {
  const characters = input.character_count ?? 2;
  const setup = roundMoney(
    LLM_PRICE + characters * (VOICE_DESIGN_PRICE + IMAGE_PRICE),
  );
  const length = input.length ?? "60_90";
  // Provider cost scales with finished seconds, measured against the 60_90 baseline the
  // per-episode constants above were calibrated on.
  const pictureScale =
    LENGTH_BUDGETS[length].target_episode_seconds / LENGTH_BUDGETS["60_90"].target_episode_seconds;
  const longForm = length === "900_1080";
  const perEpisode = roundMoney(
    pricing.estimateVideo("alibaba/wan-3.0", WAN_SECONDS_PER_EPISODE * pictureScale) +
      pricing.estimateVideo("bytedance/seedance-2.0-mini", MINI_SECONDS_PER_EPISODE * pictureScale) +
      pricing.estimateVideo("bytedance/seedance-2.5", HERO_SECONDS_PER_EPISODE * pictureScale) +
      pricing.estimateDialogue() * DIALOGUE_LINES_PER_EPISODE * pictureScale +
      VISION_PRICE * TAKES_PER_EPISODE * pictureScale +
      STT_PRICE_PER_MINUTE * STT_MINUTES_PER_SAMPLE * STT_SAMPLES_PER_EPISODE * pictureScale +
      LLM_PRICE * (longForm ? LLM_CALLS_PER_LONG_EPISODE : LLM_CALLS_PER_EPISODE),
  );
  const generate = roundMoney(perEpisode * input.episode_count);
  const estimated_min = roundMoney(setup + generate);
  return {
    episode_count: input.episode_count,
    setup,
    generate,
    estimated_min,
    estimated_max: roundMoney(estimated_min * REGEN_BUFFER),
    // Legacy season prices are the balanced 60s Pro rate; length and catalog picture scale the same way as retailForBlock.
    retail: Math.round(
      SEASON_PRICES_USD[input.episode_count] * LENGTH_FACTOR[length] * PICTURE_FACTOR[input.video_tier ?? "pro"],
    ),
  };
}
