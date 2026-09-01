import { DiskAssetStore } from "./disk.ts";
import { HttpAssetStore } from "./http.ts";
import type { AssetStore } from "./types.ts";

export { setAssetFetch, mediaFetch } from "./fetch.ts";

export function mediaStoreConfigured(): boolean {
  return Boolean(
    process.env.MEDIA_STORE_URL?.trim() &&
      process.env.MEDIA_SIGNING_SECRET?.trim() &&
      process.env.MEDIA_STORE_TOKEN?.trim(),
  );
}

export function createConfiguredAssetStore(): AssetStore {
  if (mediaStoreConfigured()) {
    return new HttpAssetStore({
      baseUrl: process.env.MEDIA_STORE_URL!.trim(),
      signingSecret: process.env.MEDIA_SIGNING_SECRET!.trim(),
      token: process.env.MEDIA_STORE_TOKEN!.trim(),
    });
  }
  const diskRoot = process.env.ASSET_DIR?.trim();
  if (diskRoot) {
    return new DiskAssetStore(diskRoot);
  }
  throw new Error(
    "No fetchable asset store is configured. Set MEDIA_STORE_URL, MEDIA_SIGNING_SECRET, and MEDIA_STORE_TOKEN for Cloudflare R2, or ASSET_DIR for a local disk store. memory:// URLs are not allowed on the live path.",
  );
}
