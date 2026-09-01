import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Asset } from "../domain.ts";
import type { AssetStore, PutAssetInput } from "./types.ts";

export class DiskAssetStore implements AssetStore {
  private readonly assets = new Map<string, Asset>();

  constructor(private readonly root: string) {}

  private filePath(asset: Pick<Asset, "storage_path">): string {
    return join(this.root, asset.storage_path);
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
    const path = this.filePath(asset);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    this.assets.set(asset.id, asset);
    return asset;
  }

  async get(id: string): Promise<{ asset: Asset; body: Uint8Array } | null> {
    const asset = this.assets.get(id);
    if (!asset || asset.deleted_at) return null;
    const body = new Uint8Array(await readFile(this.filePath(asset)));
    return { asset, body };
  }

  async getSignedUrl(id: string, _ttlSeconds: number): Promise<string> {
    const row = await this.get(id);
    if (!row) throw new Error(`Asset not found: ${id}`);
    return `data:${row.asset.mime_type};base64,${Buffer.from(row.body).toString("base64")}`;
  }

  async delete(id: string, deletedAt: string): Promise<void> {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.set(id, { ...asset, deleted_at: deletedAt });
    await rm(this.filePath(asset), { force: true });
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
