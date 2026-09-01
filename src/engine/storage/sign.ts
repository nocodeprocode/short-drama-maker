function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonical(method: string, key: string, exp: number): string {
  return `${method}\n${key}\n${exp}`;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function assertSafeKey(key: string): void {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }
}

export async function signAssetAccess(
  secret: string,
  method: string,
  key: string,
  exp: number,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(canonical(method, key, exp)),
  );
  return hex(signature);
}

export async function verifyAssetAccess(
  secret: string,
  method: string,
  key: string,
  exp: number,
  signature: string,
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await signAssetAccess(secret, method, key, exp);
  return expected === signature;
}

export async function signedGetUrl(
  baseUrl: string,
  secret: string,
  key: string,
  ttlSeconds: number,
): Promise<string> {
  assertSafeKey(key);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await signAssetAccess(secret, "GET", key, exp);
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/$/, "")}/o/${encoded}?exp=${exp}&sig=${sig}`;
}
