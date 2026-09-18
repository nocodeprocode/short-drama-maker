import { describe, expect, it } from "vitest";
import { imagePreviewUrl } from "../../supabase/functions/_shared/sign.ts";

describe("imagePreviewUrl", () => {
  it("requests a WebP derivative without changing the signed original URL", () => {
    const original = "https://media.example/o/source.png?exp=10&sig=abc";
    expect(imagePreviewUrl(original)).toBe(`${original}&preview=webp`);
    expect(original.endsWith("sig=abc")).toBe(true);
  });
});
