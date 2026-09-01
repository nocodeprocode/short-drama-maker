import type { Asset, AssetBucket } from "../domain.ts";

export type PutAssetInput = {
  id: string;
  owner_id: string;
  series_id: string | null;
  actor_id?: string | null;
  kind: Asset["kind"];
  bucket: AssetBucket;
  storage_path: string;
  mime_type: string;
  body: Uint8Array;
  checksum: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export interface AssetStore {
  put(input: PutAssetInput): Promise<Asset>;
  get(id: string): Promise<{ asset: Asset; body: Uint8Array } | null>;
  getSignedUrl(id: string, ttlSeconds: number): Promise<string>;
  delete(id: string, deletedAt: string): Promise<void>;
  listBySeries(seriesId: string): Promise<Asset[]>;
}
