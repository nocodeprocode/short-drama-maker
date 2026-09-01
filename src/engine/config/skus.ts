import { IMAGE_PRICE, LLM_PRICE, VOICE_DESIGN_PRICE } from "./models.ts";
import { pricing, roundMoney } from "../ai/pricing.ts";
import type { SeasonSku } from "../domain.ts";

export const SEASON_SKUS = [2, 12, 24, 45, 60] as const;

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
export const REGEN_BUFFER = 1.15;

export function isSeasonSku(value: unknown): value is SeasonSku {
  return SEASON_SKUS.includes(Number(value) as SeasonSku);
}

export function isCatalogSku(value: unknown): value is CatalogSku {
  return value === "topup" || isSeasonSku(value);
}

export function estimateSeries(input: {
  episode_count: SeasonSku;
  character_count?: number;
  length?: import("./catalog.ts").EpisodeLength;
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
  const perEpisode = roundMoney(
    pricing.estimateVideo("alibaba/wan-3.0", WAN_SECONDS_PER_EPISODE * pictureScale) +
      pricing.estimateVideo("bytedance/seedance-2.0-mini", MINI_SECONDS_PER_EPISODE * pictureScale) +
      pricing.estimateDialogue() * DIALOGUE_LINES_PER_EPISODE * pictureScale,
  );
  const generate = roundMoney(perEpisode * input.episode_count);
  const estimated_min = roundMoney(setup + generate);
  return {
    episode_count: input.episode_count,
    setup,
    generate,
    estimated_min,
    estimated_max: roundMoney(estimated_min * REGEN_BUFFER),
    retail: SEASON_PRICES_USD[input.episode_count],
  };
}
