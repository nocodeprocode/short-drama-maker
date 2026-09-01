import type { Asset } from "../domain.ts";
import { mediaFetch } from "./fetch.ts";
import { signedGetUrl } from "./sign.ts";
import type { AssetStore, PutAssetInput } from "./types.ts";

export type HttpAssetStoreConfig = {
  baseUrl: string;
  signingSecret: string;
  token: string;
};

export class HttpAssetStore implements AssetStore {
  private readonly assets = new Map<string, Asset>();

  constructor(private readonly config: HttpAssetStoreConfig) {}

  hydrate(rows: readonly Asset[]): void {
    for (const asset of rows) {
      this.assets.set(asset.id, asset);
    }
  }

  private objectUrl(key: string): string {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.config.baseUrl.replace(/\/$/, "")}/o/${encoded}`;
  }

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
    const response = await mediaFetch(this.objectUrl(asset.storage_path), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": asset.mime_type,
      },
      body: Buffer.from(input.body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Media store PUT failed HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    this.assets.set(asset.id, asset);
    return asset;
  }

  async get(id: string): Promise<{ asset: Asset; body: Uint8Array } | null> {
    const asset = this.assets.get(id);
    if (!asset || asset.deleted_at) return null;
    const url = await this.getSignedUrl(id, 60);
    const response = await mediaFetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Media store GET failed HTTP ${response.status}`);
    }
    return { asset, body: new Uint8Array(await response.arrayBuffer()) };
  }

  async getSignedUrl(id: string, ttlSeconds: number): Promise<string> {
    const asset = this.assets.get(id);
    if (!asset || asset.deleted_at) throw new Error(`Asset not found: ${id}`);
    return signedGetUrl(this.config.baseUrl, this.config.signingSecret, asset.storage_path, ttlSeconds);
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.set(id, { ...asset, deleted_at: deletedAt });
    const response = await mediaFetch(this.objectUrl(asset.storage_path), {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.config.token}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Media store DELETE failed HTTP ${response.status}`);
    }
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
