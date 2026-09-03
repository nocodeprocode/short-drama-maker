import type { Asset } from "../domain.ts";
import { mediaFetch } from "./fetch.ts";
import { signedGetUrl } from "./sign.ts";
import type { AssetStore, PutAssetInput } from "./types.ts";

export type HttpAssetStoreConfig = {
  baseUrl: string;
  signingSecret: string;
  token: string;
};

/** Above this a single request body is refused at the edge; go multipart. */
export const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;
/** R2 wants every part but the last the same size, and at least 5 MiB. */
export const MULTIPART_PART_BYTES = 32 * 1024 * 1024;

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
    if (input.body.byteLength > MULTIPART_THRESHOLD_BYTES) {
      await this.putMultipart(asset.storage_path, asset.mime_type, input.body);
    } else {
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
    }
    this.assets.set(asset.id, asset);
    return asset;
  }

  /**
   * Objects past one request body go up in equal parts (the last may be
   * shorter) and are completed in one step; on any failure the upload is
   * aborted so R2 keeps no orphaned parts.
   */
  private async putMultipart(key: string, mimeType: string, body: Uint8Array): Promise<void> {
    const auth = { authorization: `Bearer ${this.config.token}` };
    const base = this.objectUrl(key);
    const created = await mediaFetch(`${base}?uploads`, { method: "POST", headers: { ...auth, "content-type": mimeType } });
    if (!created.ok) throw new Error(`Media store multipart create failed HTTP ${created.status}`);
    const { uploadId } = (await created.json()) as { uploadId: string };
    const parts: Array<{ partNumber: number; etag: string }> = [];
    try {
      for (let offset = 0, partNumber = 1; offset < body.byteLength; offset += MULTIPART_PART_BYTES, partNumber += 1) {
        const chunk = body.subarray(offset, Math.min(body.byteLength, offset + MULTIPART_PART_BYTES));
        const response = await mediaFetch(`${base}?uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`, {
          method: "PUT",
          headers: { ...auth, "content-type": "application/octet-stream" },
          body: Buffer.from(chunk),
        });
        if (!response.ok) throw new Error(`Media store part ${partNumber} failed HTTP ${response.status}`);
        const { etag } = (await response.json()) as { etag: string };
        parts.push({ partNumber, etag });
      }
      const done = await mediaFetch(`${base}?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ parts }),
      });
      if (!done.ok) throw new Error(`Media store multipart complete failed HTTP ${done.status}`);
    } catch (error) {
      await mediaFetch(`${base}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE", headers: auth }).catch(() => undefined);
      throw error;
    }
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
