import { describe, expect, it } from "vitest";
import { estimateBlock, retailForBlock } from "./catalog.ts";
import { estimateSeries, isCatalogSku, SEASON_PRICES_USD } from "./skus.ts";

describe("block SKUs", () => {
  it("prices the pilot, four blocks, and the top-up", () => {
    expect(SEASON_PRICES_USD[2]).toBe(76);
    expect(SEASON_PRICES_USD[60]).toBe(1824);
    expect(SEASON_PRICES_USD.topup).toBe(49);
    expect(isCatalogSku(2)).toBe(true);
    expect(isCatalogSku(15)).toBe(false);
    expect(isCatalogSku("topup")).toBe(true);
  });

  it("applies volume pricing from the order summary", () => {
    expect(retailForBlock(2, "balanced", "60_90")).toBe(76);
    expect(retailForBlock(12, "balanced", "60_90")).toBe(433);
    expect(retailForBlock(60, "balanced", "60_90")).toBe(1824);
  });

  it("returns finished runtime and run time with the estimate", () => {
    const estimate = estimateBlock({ sku: 2, priority: "balanced", length: "60_90" });
    expect(estimate.is_pilot).toBe(true);
    expect(estimate.finished_runtime_seconds).toBe(150);
    expect(estimate.retail).toBe(76);
    expect(estimate.estimated_min).toBeGreaterThan(0);
  });

  it("keeps a 60-episode block's provider cost well below retail", () => {
    const estimate = estimateSeries({ episode_count: 60 });
    expect(estimate.estimated_max).toBeLessThan(estimate.retail);
    expect(estimate.retail).toBe(1824);
  });

  it("prices the 15-min SKU above the 60s SKU on retail and COGS", () => {
    expect(retailForBlock(2, "balanced", "900_1080")).toBe(1140);
    expect(retailForBlock(2, "balanced", "60_90")).toBe(76);
    const short = estimateSeries({ episode_count: 2, length: "60_90" });
    const long = estimateSeries({ episode_count: 2, length: "900_1080" });
    expect(long.estimated_min).toBeGreaterThan(short.estimated_min * 8);
    expect(estimateBlock({ sku: 2, priority: "balanced", length: "900_1080" }).finished_runtime_seconds).toBe(1800);
  });
});

describe("sku.720p", () => {
  it("estimates Wan at the 720p $0.10 rate", async () => {
    const { pricing } = await import("../ai/pricing.ts");
    expect(pricing.estimateVideo("alibaba/wan-3.0", 32)).toBe(3.2);
  });
});
