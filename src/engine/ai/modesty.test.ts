import { describe, expect, it } from "vitest";
import { MODEST_DRESS_RULE, MODEST_WARDROBE_EXAMPLES, modestDressFail } from "./modesty.ts";

describe("modest dress rule", () => {
  it("is a hard public-decency rule, not a suggestion", () => {
    expect(MODEST_DRESS_RULE).toMatch(/Clothes stay on/);
    expect(MODEST_DRESS_RULE).toMatch(/Do not take clothes off/);
    expect(MODEST_WARDROBE_EXAMPLES).toMatch(/dress|suit|blouse/);
  });

  it("flags sheer cloth and a visible bra", () => {
    expect(modestDressFail("sheer ivory turtleneck, bra visible")).toBe(true);
    expect(modestDressFail("opaque navy knit, closed neckline")).toBe(false);
  });
});
