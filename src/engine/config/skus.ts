import { IMAGE_PRICE, LLM_PRICE, STT_PRICE_PER_MINUTE, VISION_PRICE, VOICE_DESIGN_PRICE } from "./models.ts";
import { pricing, roundMoney } from "../ai/pricing.ts";
import type { SeasonSku } from "../domain.ts";

export const SEASON_SKUS = [2, 12, 24, 45, 60] as const;

export type EpisodeLength = "30_45" | "60_90" | "120_180" | "900_1080";

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

export type CatalogSku = SeasonSku | "topup";

export const SEASON_PRICES_USD: Record<CatalogSku, number> = {
  2: 76,
  12: 433,
  24: 821,
  45: 1436,
  60: 1824,
  topup: 49,
};

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
  return value === "topup" || isSeasonSku(value);
}

export function estimateSeries(input: {
  episode_count: SeasonSku;
  character_count?: number;
  length?: EpisodeLength;
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
  const pictureScale =
    length === "900_1080" ? 900 / 75 : length === "120_180" ? 150 / 75 : length === "30_45" ? 38 / 75 : 1;
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
    // Legacy season prices are the balanced 60s rate; longer episodes scale by the same factor the catalog uses.
    retail: Math.round(SEASON_PRICES_USD[input.episode_count] * LENGTH_FACTOR[length]),
  };
}
