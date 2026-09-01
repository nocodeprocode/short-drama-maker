import type { Asset } from "../domain.ts";
import type { AssetStore, PutAssetInput } from "./types.ts";

export class MemoryAssetStore implements AssetStore {
  private readonly assets = new Map<string, Asset>();
  private readonly bodies = new Map<string, Uint8Array>();

  async put(input: PutAssetInput): Promise<Asset> {
    const existing = this.assets.get(input.id);
    const asset: Asset = {
      id: input.id,
      owner_id: input.owner_id,
      series_id: input.series_id,
      actor_id: input.actor_id ?? null,
      kind: input.kind,
      bucket: input.bucket,
      storage_path: input.storage_path,
      mime_type: input.mime_type,
      bytes: input.body.byteLength,
      checksum: input.checksum,
      metadata: input.metadata,
      created_at: existing?.created_at ?? input.created_at,
      deleted_at: null,
    };
    this.assets.set(asset.id, asset);
    this.bodies.set(asset.id, input.body);
    return asset;
  }

  async get(id: string): Promise<{ asset: Asset; body: Uint8Array } | null> {
    const asset = this.assets.get(id);
    const body = this.bodies.get(id);
    if (!asset || !body || asset.deleted_at) return null;
    return { asset, body };
  }

  async getSignedUrl(id: string, ttlSeconds: number): Promise<string> {
    const row = await this.get(id);
    if (!row) throw new Error(`Asset not found: ${id}`);
    const expires = Date.now() + ttlSeconds * 1000;
    return `memory://${row.asset.storage_path}?exp=${expires}`;
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.set(id, { ...asset, deleted_at: deletedAt });
    this.bodies.delete(id);
  }

  async listBySeries(seriesId: string): Promise<Asset[]> {
    return [...this.assets.values()].filter(
      (asset) => asset.series_id === seriesId && !asset.deleted_at,
    );
  }

  snapshot(): Asset[] {
    return [...this.assets.values()];
  }
}
