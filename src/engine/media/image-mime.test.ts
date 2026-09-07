import { describe, expect, it } from "vitest";
import { honestImageMime, imageDataUrl, sniffImageMime } from "./image-mime.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("sniffImageMime", () => {
  it("reads PNG, JPEG, and WebP magic and ignores a lying declaration", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
    expect(honestImageMime(JPEG, "image/png")).toBe("image/jpeg");
    expect(honestImageMime(new Uint8Array([0x00]), "image/png")).toBe("image/png");
    expect(imageDataUrl(JPEG, "image/png")).toMatch(/^data:image\/jpeg;base64,/);
  });
});
