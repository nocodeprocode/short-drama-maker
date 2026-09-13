import { describe, expect, it } from "vitest";
import { estimateBlock, retailForBlock } from "./catalog.ts";
import { estimateSeries, isCatalogSku, SEASON_PRICES_USD } from "./skus.ts";

describe("block SKUs", () => {
  it("prices the pilot, long-form blocks, and the top-up", () => {
    expect(SEASON_PRICES_USD[2]).toBe(76);
    expect(SEASON_PRICES_USD[15]).toBe(542);
    expect(SEASON_PRICES_USD[30]).toBe(1026);
    expect(SEASON_PRICES_USD[50]).toBe(1596);
    expect(SEASON_PRICES_USD[60]).toBe(1824);
    expect(SEASON_PRICES_USD[90]).toBe(2736);
    expect(SEASON_PRICES_USD.topup).toBe(49);
    expect(isCatalogSku(2)).toBe(true);
    expect(isCatalogSku(15)).toBe(true);
    expect(isCatalogSku(30)).toBe(true);
    expect(isCatalogSku(90)).toBe(true);
    expect(isCatalogSku(18)).toBe(false);
    expect(isCatalogSku("topup")).toBe(true);
    expect(isCatalogSku("credit")).toBe(true);
  });

  it("prices the 60 second tier below the 90 second tier", () => {
    expect(retailForBlock(30, "balanced", "45_60")).toBe(718);
    expect(retailForBlock(60, "balanced", "45_60")).toBe(1277);
    expect(retailForBlock(30, "balanced", "45_60")).toBeLessThan(retailForBlock(30, "balanced", "60_90"));
  });

  it("applies volume pricing from the order summary", () => {
    expect(retailForBlock(2, "balanced", "60_90")).toBe(76);
    expect(retailForBlock(12, "balanced", "60_90")).toBe(433);
    expect(retailForBlock(15, "balanced", "60_90")).toBe(542);
    expect(retailForBlock(24, "balanced", "60_90")).toBe(821);
    expect(retailForBlock(30, "balanced", "60_90")).toBe(1026);
    expect(retailForBlock(45, "balanced", "60_90")).toBe(1436);
    expect(retailForBlock(50, "balanced", "60_90")).toBe(1596);
    expect(retailForBlock(60, "balanced", "60_90")).toBe(1824);
    expect(retailForBlock(90, "balanced", "60_90")).toBe(2736);
  });

  it("applies the catalog picture factor without inventing a second price book", () => {
    expect(retailForBlock(30, "balanced", "60_90", "catalog")).toBe(770);
    expect(retailForBlock(60, "balanced", "60_90", "catalog")).toBe(1368);
    expect(retailForBlock(90, "balanced", "60_90", "catalog")).toBe(2052);
  });

  it("returns finished runtime and run time with the estimate", () => {
    const estimate = estimateBlock({ sku: 2, priority: "balanced", length: "60_90" });
    expect(estimate.is_pilot).toBe(true);
    expect(estimate.finished_runtime_seconds).toBe(180);
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
    // Both pricing paths must agree on what a 15-minute pilot retails for.
    expect(long.retail).toBe(retailForBlock(2, "balanced", "900_1080"));
    expect(long.estimated_max).toBeLessThan(long.retail);
    // COGS includes the hero route, identity judgements, STT samples and the planner calls.
    expect(short.generate / 2).toBeGreaterThan(5);
    expect(estimateBlock({ sku: 2, priority: "balanced", length: "900_1080" }).finished_runtime_seconds).toBe(1800);
  });
});

describe("sku.720p", () => {
  it("estimates Wan at the 720p $0.10 rate", async () => {
    const { pricing } = await import("../ai/pricing.ts");
    expect(pricing.estimateVideo("alibaba/wan-3.0", 32)).toBe(3.2);
  });
});
