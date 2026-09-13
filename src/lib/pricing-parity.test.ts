import { describe, expect, it } from "vitest";
import * as edge from "../../supabase/functions/_shared/skus.ts";
import { LENGTH_BUDGETS } from "@/drama-engine/types/pacing.ts";
import {
  LENGTH_FACTOR,
  PICTURE_FACTOR,
  PRIORITY_RATES_USD,
  SECONDS_PER_EPISODE,
  retailForBlock,
  type BlockSku,
  type EpisodeLength,
  type ProductionPriority,
} from "@/engine/config/catalog.ts";
import { episodeSeconds, retailFor } from "./catalog.ts";

const LENGTHS: EpisodeLength[] = ["30_45", "45_60", "60_90", "120_180", "900_1080"];
const PRIORITIES: ProductionPriority[] = ["fast", "balanced", "quality"];
const TIERS = ["pro", "catalog"] as const;
const SKUS: BlockSku[] = [2, 12, 15, 24, 30, 45, 50, 60, 90];

describe("quoted runtime", () => {
  it("quotes the seconds the planner actually shoots", () => {
    for (const length of LENGTHS) {
      expect(SECONDS_PER_EPISODE[length]).toBe(LENGTH_BUDGETS[length].target_episode_seconds);
      expect(edge.SECONDS_PER_EPISODE[length]).toBe(LENGTH_BUDGETS[length].target_episode_seconds);
      expect(episodeSeconds(length)).toBe(LENGTH_BUDGETS[length].target_episode_seconds);
    }
  });

  it("bills a 30-episode 60_90 season as the 45 minutes it delivers", () => {
    expect((SECONDS_PER_EPISODE["60_90"] * 30) / 60).toBe(45);
  });
});

describe("price book parity", () => {
  it("keeps the rate tables identical across client, engine, and edge", () => {
    expect(edge.PRIORITY_RATES_USD).toEqual(PRIORITY_RATES_USD);
    expect(edge.LENGTH_FACTOR).toEqual(LENGTH_FACTOR);
    expect(edge.PICTURE_FACTOR).toEqual(PICTURE_FACTOR);
  });

  it("agrees on every sku, length, tier, and priority", () => {
    for (const sku of SKUS) {
      for (const length of LENGTHS) {
        for (const priority of PRIORITIES) {
          for (const tier of TIERS) {
            const engineRetail = retailForBlock(sku, priority, length, tier);
            expect(edge.retailForBlock(sku, priority, length, tier)).toBe(engineRetail);
            expect(retailFor(sku, priority, length, tier)).toBe(engineRetail);
          }
        }
      }
    }
  });

  it("holds the 2x price on the 2 minute tier", () => {
    expect(LENGTH_FACTOR["120_180"]).toBe(2);
    expect(retailForBlock(30, "balanced", "120_180")).toBe(retailForBlock(30, "balanced", "60_90") * 2);
  });

  it("keeps each tier's premium over pure runtime visible", () => {
    // Price per delivered minute, relative to the 60_90 tier. Above 1 means the
    // tier is priced above its runtime share, which is deliberate.
    const perMinute = (length: EpisodeLength) =>
      retailForBlock(30, "balanced", length) / (SECONDS_PER_EPISODE[length] * 30 / 60);
    const baseline = perMinute("60_90");
    const premium = (length: EpisodeLength) => Number((perMinute(length) / baseline).toFixed(2));

    expect(premium("30_45")).toBe(1.42);
    expect(premium("45_60")).toBe(1.05);
    expect(premium("60_90")).toBe(1);
    expect(premium("120_180")).toBe(1.5);
    expect(premium("900_1080")).toBe(1.5);
  });

  it("returns 0 from the client for skus and lengths it cannot price", () => {
    expect(retailFor(7, "balanced", "60_90", "pro")).toBe(0);
    expect(retailFor(30, "balanced", "nonsense", "pro")).toBe(0);
  });
});
