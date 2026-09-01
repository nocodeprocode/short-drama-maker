import { describe, expect, it } from "vitest";
import { assertSafeKey, signAssetAccess, signedGetUrl, verifyAssetAccess } from "./sign.ts";

describe("asset URL signing", () => {
  it("accepts a matching signature and rejects a bad one", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = await signAssetAccess("secret", "GET", "private-generation/a.mp4", exp);
    expect(await verifyAssetAccess("secret", "GET", "private-generation/a.mp4", exp, sig)).toBe(true);
    expect(await verifyAssetAccess("secret", "GET", "private-generation/a.mp4", exp, "00")).toBe(false);
    expect(await verifyAssetAccess("other", "GET", "private-generation/a.mp4", exp, sig)).toBe(false);
  });

  it("rejects path traversal and expired signatures", async () => {
    expect(() => assertSafeKey("../etc/passwd")).toThrow(/Invalid storage key/);
    const exp = Math.floor(Date.now() / 1000) - 5;
    const sig = await signAssetAccess("secret", "GET", "ok.mp4", exp);
    expect(await verifyAssetAccess("secret", "GET", "ok.mp4", exp, sig)).toBe(false);
    const url = await signedGetUrl("https://media.example", "secret", "series/a.png", 30);
    expect(url).toContain("https://media.example/o/series/a.png?");
    expect(url).toContain("sig=");
  });
});
