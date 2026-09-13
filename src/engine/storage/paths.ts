import type { AssetBucket, AssetKind } from "../domain.ts";

export function assetPath(input: {
  bucket: AssetBucket;
  seriesId: string | null;
  kind: AssetKind;
  id: string;
  ext: string;
  ownerId?: string;
  actorId?: string;
}): string {
  if (input.actorId && input.ownerId) {
    return `${input.bucket}/${input.ownerId}/${input.actorId}/${input.kind}/${input.id}.${input.ext}`;
  }
  return `${input.bucket}/${input.seriesId ?? "portfolio"}/${input.kind}/${input.id}.${input.ext}`;
}

export function extForMime(mime: string): string {
  switch (mime) {
    case "audio/wav":
      return "wav";
    case "application/json":
      return "json";
    case "video/mp4":
      return "mp4";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "text/plain":
      return "txt";
    case "text/vtt":
      return "vtt";
    default:
      return "bin";
  }
}
