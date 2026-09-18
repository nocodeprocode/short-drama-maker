import type { Service } from "./productions.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SEED_BYTES = 8 * 1024 * 1024;

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string): Uint8Array {
  const cleaned = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function decodeSeedPhoto(seedBase64: string, mimeType?: string): { bytes: Uint8Array; mime: string } {
  const mime = ALLOWED_MIME.has(String(mimeType ?? "")) ? String(mimeType) : "image/jpeg";
  const bytes = decodeBase64(seedBase64);
  if (!bytes.byteLength) throw new Error("The photo was empty.");
  if (bytes.byteLength > MAX_SEED_BYTES) throw new Error("That photo is too large. Use a file under 8 MB.");
  return { bytes, mime };
}

/**
 * Writes the buyer's seed photo to the media store and the assets table in
 * this request, so the card can show it immediately and a failed generate
 * task does not lose the upload.
 */
export async function putSeedAsset(
  supabase: Service,
  input: {
    ownerId: string;
    actorId: string;
    seriesId?: string | null;
    bytes: Uint8Array;
    mime: string;
  },
): Promise<{ id: string; storage_path: string }> {
  const base = Deno.env.get("MEDIA_STORE_URL")?.trim();
  const token = Deno.env.get("MEDIA_STORE_TOKEN")?.trim();
  if (!base || !token) throw new Error("Photo storage is not configured.");

  const id = crypto.randomUUID();
  const storagePath = `private-character/${input.ownerId}/${input.actorId}/character_reference/${id}.${extForMime(input.mime)}`;
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const checksum = hex(await crypto.subtle.digest("SHA-256", input.bytes));

  const response = await fetch(`${base.replace(/\/$/, "")}/o/${encoded}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": input.mime,
    },
    body: input.bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Could not store the photo (${response.status}): ${text.slice(0, 160)}`);
  }

  const { error } = await supabase.from("assets").insert({
    id,
    owner_id: input.ownerId,
    series_id: input.seriesId ?? null,
    actor_id: input.actorId,
    kind: "character_reference",
    bucket: "private-character",
    storage_path: storagePath,
    mime_type: input.mime,
    bytes: input.bytes.byteLength,
    checksum,
    metadata: { actor_id: input.actorId, kind: "seed" },
  });
  if (error) throw new Error(error.message);
  return { id, storage_path: storagePath };
}

/** Newest uploaded face photo for this actor, if any. */
export function pickLatestSeedId(
  rows: Array<{ id: string; metadata?: unknown; created_at: string }>,
): string | null {
  const seeds = rows
    .filter((row) => (row.metadata as { kind?: string } | null)?.kind === "seed")
    .sort((left, right) => (left.created_at < right.created_at ? 1 : left.created_at > right.created_at ? -1 : 0));
  return seeds[0]?.id ?? null;
}

export async function latestSeedAssetId(
  supabase: Service,
  input: { ownerId: string; actorId: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("assets")
    .select("id, metadata, created_at")
    .eq("owner_id", input.ownerId)
    .eq("actor_id", input.actorId)
    .eq("kind", "character_reference")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(40);
  return pickLatestSeedId((data ?? []) as Array<{ id: string; metadata?: unknown; created_at: string }>);
}

/**
 * Older generate_actor tasks stored the photo in the payload. Pull it out
 * once so regenerate can run the likeness path without asking for a re-upload.
 */
export async function recoverSeedFromTasks(
  supabase: Service,
  input: { ownerId: string; actorId: string; seriesId?: string | null },
): Promise<string | null> {
  const { data } = await supabase
    .from("engine_tasks")
    .select("payload")
    .eq("owner_id", input.ownerId)
    .eq("action", "generate_actor")
    .order("created_at", { ascending: false })
    .limit(40);
  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as { actor_id?: string; seed_base64?: string; seed_mime_type?: string };
    if (String(payload.actor_id ?? "") !== input.actorId) continue;
    if (typeof payload.seed_base64 !== "string" || !payload.seed_base64) continue;
    const photo = decodeSeedPhoto(payload.seed_base64, payload.seed_mime_type);
    const stored = await putSeedAsset(supabase, {
      ownerId: input.ownerId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      bytes: photo.bytes,
      mime: photo.mime,
    });
    return stored.id;
  }
  return null;
}
