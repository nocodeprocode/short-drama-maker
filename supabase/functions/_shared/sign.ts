function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signedGetUrl(
  baseUrl: string,
  secret: string,
  key: string,
  ttlSeconds: number,
): Promise<string> {
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    throw new Error("Invalid storage key");
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(`GET\n${key}\n${exp}`),
  );
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/$/, "")}/o/${encoded}?exp=${exp}&sig=${hex(signature)}`;
}

export async function signAssetRows(
  rows: Array<{ id: string; kind: string; mime_type: string; storage_path: string; metadata?: Record<string, unknown>; created_at: string }>,
): Promise<Array<{ id: string; kind: string; mime: string; url: string; label: string; created_at: string }>> {
  const base = Deno.env.get("MEDIA_STORE_URL")?.trim();
  const secret = Deno.env.get("MEDIA_SIGNING_SECRET")?.trim();
  if (!base || !secret) return [];
  const out = [];
  for (const row of rows) {
    try {
      out.push({
        id: row.id,
        kind: row.kind,
        mime: row.mime_type,
        url: await signedGetUrl(base, secret, row.storage_path, 60 * 30),
        label: assetLabel(row.kind, row.metadata ?? {}),
        created_at: row.created_at,
      });
    } catch {
      /* skip unsigned */
    }
  }
  return out;
}

function assetLabel(kind: string, metadata: Record<string, unknown>): string {
  if (kind === "series_cover") return "Series cover";
  if (kind === "character_reference") return String(metadata.kind ?? "Character still");
  if (kind === "voice_preview" || kind === "voice_reference") return "Voice preview";
  if (kind === "dialogue_audio") return "Dialogue";
  if (kind === "shot_video") {
    const episode = metadata.episode_number;
    const shot = metadata.shot_position;
    const speaker = typeof metadata.speaker === "string" && metadata.speaker ? metadata.speaker : null;
    if (typeof episode === "number" && typeof shot === "number") {
      return speaker ? `Episode ${episode} · Shot ${shot} · ${speaker}` : `Episode ${episode} · Shot ${shot}`;
    }
    return "Shot";
  }
  if (kind === "episode_final") return "Finished episode";
  return kind.replaceAll("_", " ");
}
