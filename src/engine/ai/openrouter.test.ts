import { describe, expect, it } from "vitest";
import { openRouterProvider } from "./openrouter.ts";

describe("OpenRouter privacy", () => {
  it("sends ZDR for text and images, and omits ZDR for video", () => {
    expect(openRouterProvider()).toEqual({
      zdr: true,
      data_collection: "deny",
      allow_fallbacks: false,
    });
    expect(openRouterProvider("image")).toEqual({
      zdr: true,
      data_collection: "deny",
      allow_fallbacks: false,
    });
    expect(openRouterProvider("video")).toEqual({
      data_collection: "deny",
      allow_fallbacks: false,
    });
  });
});
