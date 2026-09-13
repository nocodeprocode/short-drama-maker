import { describe, expect, it } from "vitest";
import {
  BLOCK_SKUS,
  CATALOG_SKUS,
  COMMISSION_LENGTHS,
  COMMISSION_SKUS,
  CREDIT_PRESETS,
  DEFAULT_COMMISSION_LENGTH,
  DEFAULT_COMMISSION_SKU,
  gapCharge,
  PRIMARY_SKUS,
  commissionLength,
  commissionSku,
  episodeSeconds,
  finishedRuntimeLabel,
  retailFor,
  runtimeLabel,
  skuLabel,
} from "./catalog.ts";

describe("catalog SKUs", () => {
  it("exposes 15/30/45/60/90 as the sellable season sizes", () => {
    expect(CATALOG_SKUS).toEqual([2, 12, 15, 24, 30, 45, 50, 60, 90]);
    expect(BLOCK_SKUS).toEqual([15, 30, 45, 60, 90]);
    expect(PRIMARY_SKUS).toEqual([15, 30, 45, 60, 90]);
    expect(CREDIT_PRESETS).toEqual([49, 100, 250, 500, 1000]);
    expect(skuLabel(2)).toBe("2-episode pilot");
    expect(skuLabel(15)).toBe("15 episodes");
    expect(skuLabel(30)).toBe("30 episodes");
    expect(skuLabel(90)).toBe("90 episodes");
    expect(skuLabel("topup")).toBe("Studio credit");
    expect(skuLabel("credit")).toBe("Studio credit");
  });

  it("prices catalog picture below pro for the same run", () => {
    expect(retailFor(30, "balanced", "60_90", "pro")).toBe(1026);
    expect(retailFor(30, "balanced", "60_90", "catalog")).toBe(770);
    expect(retailFor(15, "balanced", "60_90", "catalog")).toBeLessThan(retailFor(15, "balanced", "60_90", "pro"));
    expect(finishedRuntimeLabel(30, "60_90")).toBe("45 min");
    expect(finishedRuntimeLabel(2, "60_90")).toBe("3 min");
    expect(finishedRuntimeLabel(15, "900_1080")).toBe("3 h 45 min");
  });

  it("keeps the two shortest episode lengths visually distinct", () => {
    expect(runtimeLabel(episodeSeconds("30_45"))).toBe("38 sec");
    expect(runtimeLabel(episodeSeconds("45_60"))).toBe("60 sec");
    expect(runtimeLabel(episodeSeconds("60_90"))).toBe("90 sec");
    expect(runtimeLabel(episodeSeconds("120_180"))).toBe("120 sec");
    expect(runtimeLabel(episodeSeconds("900_1080"))).toBe("15 min");
  });

  it("lets length and count mix independently", () => {
    expect(COMMISSION_SKUS).toEqual([15, 30, 45, 60, 90]);
    expect(COMMISSION_LENGTHS).toEqual(["45_60", "60_90", "120_180"]);
    expect(DEFAULT_COMMISSION_SKU).toBe(30);
    expect(DEFAULT_COMMISSION_LENGTH).toBe("60_90");
    expect(commissionSku(15)).toBe(15);
    expect(commissionSku(45)).toBe(45);
    expect(commissionSku(90)).toBe(90);
    expect(commissionSku(12)).toBe(15);
    expect(commissionSku(50)).toBe(45);
    expect(commissionLength("45_60")).toBe("45_60");
    expect(commissionLength("900_1080")).toBe("120_180");
    expect(commissionLength("30_45")).toBe("60_90");
    expect(finishedRuntimeLabel(30, "45_60")).toBe("30 min");
    expect(finishedRuntimeLabel(45, "45_60")).toBe("45 min");
    expect(finishedRuntimeLabel(60, "45_60")).toBe("60 min");
    expect(finishedRuntimeLabel(30, "60_90")).toBe("45 min");
    expect(finishedRuntimeLabel(45, "60_90")).toBe("68 min");
    expect(finishedRuntimeLabel(60, "60_90")).toBe("90 min");
    expect(finishedRuntimeLabel(30, "120_180")).toBe("60 min");
    expect(finishedRuntimeLabel(45, "120_180")).toBe("90 min");
    expect(finishedRuntimeLabel(60, "120_180")).toBe("2 h");
    expect(retailFor(45, "balanced", "60_90", "pro")).toBeGreaterThan(retailFor(30, "balanced", "60_90", "pro"));
    expect(retailFor(30, "balanced", "120_180", "pro")).toBe(retailFor(30, "balanced", "60_90", "pro") * 2);
  });

  it("charges the quoted gap, never a preset bucket", () => {
    expect(gapCharge(379)).toBe(379);
    expect(gapCharge(379.4)).toBe(380);
    expect(gapCharge(3)).toBe(10);
  });
});
