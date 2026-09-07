/**
 * Honest image MIME from magic bytes. Providers often declare image/png while
 * returning JPEG; vision APIs 400 when the data-URL type lies.
 */

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, GIF)) return "image/gif";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}

/** Prefer sniffed bytes over a declared type; fall back to the declaration. */
export function honestImageMime(bytes: Uint8Array, declared?: string | null): string {
  return sniffImageMime(bytes) ?? declared?.split(";")[0]?.trim() ?? "application/octet-stream";
}

export function imageDataUrl(bytes: Uint8Array, declared?: string | null): string {
  return `data:${honestImageMime(bytes, declared)};base64,${Buffer.from(bytes).toString("base64")}`;
}
