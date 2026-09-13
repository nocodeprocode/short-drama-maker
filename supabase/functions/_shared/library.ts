import type { Service } from "./productions.ts";
import { propAssetKey, propKindFor } from "./design-slate.ts";
import { signedGetUrl } from "./sign.ts";

/**
 * The owner's catalog of places and objects, the half of design that used to be
 * missing. `actors` is to `series_cast` what these are to `series_locations` and
 * `series_props`: the reusable thing, separate from its use in one show.
 */

export type LibraryStatus = "planned" | "building" | "ready" | "failed";
export type LibrarySource = "generated" | "upload";

export type LocationEntry = {
  id: string;
  owner_id: string;
  name: string;
  source: string;
  notes: string;
  tags: string[] | null;
  plate_asset_id: string | null;
  seed_asset_id: string | null;
  lighting_lock: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export type PropEntry = {
  id: string;
  owner_id: string;
  name: string;
  source: string;
  notes: string;
  tags: string[] | null;
  still_asset_id: string | null;
  seed_asset_id: string | null;
  kind: string | null;
  state: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function asStatus(value: unknown): LibraryStatus {
  return value === "building" || value === "ready" || value === "failed" ? value : "planned";
}

function asSource(value: unknown): LibrarySource {
  return value === "upload" ? "upload" : "generated";
}

export function normalizeLibraryName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function presentLocationEntry(
  row: LocationEntry,
  extras: { image_url?: string | null; seed_url?: string | null; shows?: string[] } = {},
) {
  return {
    id: row.id,
    name: row.name,
    source: asSource(row.source),
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    image_url: extras.image_url ?? null,
    seed_url: extras.seed_url ?? null,
    lighting_lock: row.lighting_lock ?? null,
    status: asStatus(row.status),
    error: row.error ?? null,
    /** Titles already shooting in this room, so a used entry is not deleted by accident. */
    shows: extras.shows ?? [],
    ready: Boolean(row.plate_asset_id),
    created_at: row.created_at,
  };
}

export function presentPropEntry(
  row: PropEntry,
  extras: { image_url?: string | null; seed_url?: string | null; shows?: string[] } = {},
) {
  return {
    id: row.id,
    name: row.name,
    source: asSource(row.source),
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    image_url: extras.image_url ?? null,
    seed_url: extras.seed_url ?? null,
    kind: row.kind ?? propKindFor(row.name),
    state: row.state ?? null,
    status: asStatus(row.status),
    error: row.error ?? null,
    shows: extras.shows ?? [],
    ready: Boolean(row.still_asset_id),
    created_at: row.created_at,
  };
}

async function signOne(path: string | null | undefined): Promise<string | null> {
  const base = Deno.env.get("MEDIA_STORE_URL")?.trim();
  const secret = Deno.env.get("MEDIA_SIGNING_SECRET")?.trim();
  if (!base || !secret || !path) return null;
  try {
    return await signedGetUrl(base, secret, path, 60 * 30);
  } catch {
    return null;
  }
}

export async function signLibraryImages(supabase: Service, assetIds: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(assetIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const { data } = await supabase.from("assets").select("id, storage_path").in("id", wanted);
  for (const row of data ?? []) {
    const url = await signOne(String(row.storage_path));
    if (url) out.set(String(row.id), url);
  }
  return out;
}

/** Which shows use each catalog entry, by title. */
export async function libraryShowTitles(
  supabase: Service,
  kind: "location" | "prop",
  entryIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const wanted = [...new Set(entryIds.filter(Boolean))];
  if (!wanted.length) return out;
  const table = kind === "prop" ? "series_props" : "series_locations";
  const column = kind === "prop" ? "prop_id" : "location_id";
  const { data } = await supabase.from(table).select(`${column}, series_id`).in(column, wanted);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const seriesIds = [...new Set(rows.map((row) => String(row.series_id)).filter(Boolean))];
  if (!seriesIds.length) return out;
  const { data: shows } = await supabase.from("series").select("id, title").in("id", seriesIds);
  const titleById = new Map((shows ?? []).map((row) => [String(row.id), String(row.title ?? "Untitled")]));
  for (const row of rows) {
    const entryId = String(row[column] ?? "");
    const title = titleById.get(String(row.series_id));
    if (!entryId || !title) continue;
    const list = out.get(entryId) ?? [];
    if (!list.includes(title)) list.push(title);
    out.set(entryId, list);
  }
  return out;
}

export function decodeLibraryImage(
  base64: string,
  mimeType?: string,
): { bytes: Uint8Array<ArrayBuffer>; mime: string } {
  const mime = ALLOWED_MIME.has(String(mimeType ?? "")) ? String(mimeType) : "image/jpeg";
  const cleaned = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (!bytes.byteLength) throw new Error("That image was empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("That image is too large. Use a file under 12 MB.");
  return { bytes, mime };
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores the buyer's own picture of a room or an object. Owner-level: no series
 * id, because the point of the catalog is that it outlives any one show. The
 * bucket and kind match what the engine writes so signing and the shoot's
 * readers need no special case.
 */
export async function putLibraryImage(
  supabase: Service,
  input: {
    ownerId: string;
    kind: "location" | "prop";
    entryId: string;
    bytes: Uint8Array<ArrayBuffer>;
    mime: string;
    role: "plate" | "seed";
  },
): Promise<{ id: string; storage_path: string }> {
  const base = Deno.env.get("MEDIA_STORE_URL")?.trim();
  const token = Deno.env.get("MEDIA_STORE_TOKEN")?.trim();
  if (!base || !token) throw new Error("Image storage is not configured.");

  const id = crypto.randomUUID();
  const storagePath =
    `private-character/${input.ownerId}/${input.kind}/${input.entryId}/${input.role}/${id}.${extForMime(input.mime)}`;
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const checksum = hex(await crypto.subtle.digest("SHA-256", input.bytes));

  const response = await fetch(`${base.replace(/\/$/, "")}/o/${encoded}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": input.mime },
    body: input.bytes,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Could not store the image (${response.status}): ${text.slice(0, 160)}`);
  }

  const { error } = await supabase.from("assets").insert({
    id,
    owner_id: input.ownerId,
    series_id: null,
    kind: "character_reference",
    bucket: "private-character",
    storage_path: storagePath,
    mime_type: input.mime,
    bytes: input.bytes.byteLength,
    checksum,
    metadata: { library: input.kind, entry_id: input.entryId, role: input.role },
  });
  if (error) throw new Error(error.message);
  return { id, storage_path: storagePath };
}

/**
 * Adds what a show just built to the catalog, so the next show can shoot the
 * same room instead of paying to invent it again. Never overwrites an entry the
 * buyer already has a picture for.
 */
export async function registerBuiltLocation(
  supabase: Service,
  ownerId: string,
  input: { name: string; plateAssetId: string; lightingLock?: string | null },
): Promise<string | null> {
  const name = normalizeLibraryName(input.name);
  if (!name || !input.plateAssetId) return null;
  const { data: existing } = await supabase
    .from("locations")
    .select("id, plate_asset_id")
    .eq("owner_id", ownerId)
    .ilike("name", name)
    .maybeSingle();
  if (existing) {
    if (!existing.plate_asset_id) {
      await supabase
        .from("locations")
        .update({
          plate_asset_id: input.plateAssetId,
          lighting_lock: input.lightingLock ?? null,
          status: "ready",
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return String(existing.id);
  }
  const { data, error } = await supabase
    .from("locations")
    .insert({
      owner_id: ownerId,
      name,
      source: "generated",
      plate_asset_id: input.plateAssetId,
      lighting_lock: input.lightingLock ?? null,
      status: "ready",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return String(data.id);
}

export async function registerBuiltProp(
  supabase: Service,
  ownerId: string,
  input: { name: string; stillAssetId: string; kind?: string | null; state?: string | null },
): Promise<string | null> {
  const name = normalizeLibraryName(input.name);
  if (!name || !input.stillAssetId) return null;
  const { data: existing } = await supabase
    .from("props")
    .select("id, still_asset_id")
    .eq("owner_id", ownerId)
    .ilike("name", name)
    .maybeSingle();
  if (existing) {
    if (!existing.still_asset_id) {
      await supabase
        .from("props")
        .update({
          still_asset_id: input.stillAssetId,
          kind: input.kind ?? propKindFor(name),
          state: input.state ?? null,
          status: "ready",
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return String(existing.id);
  }
  const { data, error } = await supabase
    .from("props")
    .insert({
      owner_id: ownerId,
      name,
      source: "generated",
      still_asset_id: input.stillAssetId,
      kind: input.kind ?? propKindFor(name),
      state: input.state ?? null,
      status: "ready",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return String(data.id);
}

/**
 * Copies a catalog image into one show.
 *
 * The engine loads a show's assets by `series_id`, so an owner-level row would
 * be invisible to the shoot. A second assets row over the same stored bytes is
 * cheap, needs no re-upload, and carries the metadata the shoot already greps
 * for — the location name, or the engine's own prop key.
 */
async function materialize(
  supabase: Service,
  input: {
    ownerId: string;
    seriesId: string;
    sourceAssetId: string;
    metadata: Record<string, unknown>;
  },
): Promise<string | null> {
  const { data: source } = await supabase
    .from("assets")
    .select("storage_path, bucket, mime_type, bytes, checksum, metadata")
    .eq("id", input.sourceAssetId)
    .maybeSingle();
  if (!source) return null;
  const id = crypto.randomUUID();
  const { error } = await supabase.from("assets").insert({
    id,
    owner_id: input.ownerId,
    series_id: input.seriesId,
    kind: "character_reference",
    bucket: source.bucket ?? "private-character",
    storage_path: source.storage_path,
    mime_type: source.mime_type,
    bytes: source.bytes,
    checksum: source.checksum,
    metadata: { ...((source.metadata ?? {}) as Record<string, unknown>), ...input.metadata },
  });
  if (error) return null;
  return id;
}

/**
 * Points one of a show's rooms at a catalog entry. Writes the plate into
 * `series.location_refs` under the row's own name, because that map is what the
 * scene matcher reads when it decides where a scene is shot.
 */
export async function useLocationEntry(
  supabase: Service,
  input: {
    ownerId: string;
    seriesId: string;
    row: { id: string; name: string; locked: boolean };
    entry: LocationEntry;
  },
): Promise<{ error?: string }> {
  if (input.row.locked) return { error: "That set is already in footage." };
  if (!input.entry.plate_asset_id) return { error: "That place has no picture yet. Build or upload one first." };
  const assetId = await materialize(supabase, {
    ownerId: input.ownerId,
    seriesId: input.seriesId,
    sourceAssetId: input.entry.plate_asset_id,
    metadata: { location: input.row.name },
  });
  if (!assetId) return { error: "Could not use that place." };

  await supabase
    .from("series_locations")
    .update({
      location_id: input.entry.id,
      plate_asset_id: assetId,
      lighting_lock: input.entry.lighting_lock ?? null,
      status: "ready",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.row.id);

  const { data: series } = await supabase
    .from("series")
    .select("location_refs")
    .eq("id", input.seriesId)
    .maybeSingle();
  const refs = { ...((series?.location_refs ?? {}) as Record<string, unknown>), [input.row.name]: assetId };
  await supabase.from("series").update({ location_refs: refs }).eq("id", input.seriesId);
  return {};
}

export async function usePropEntry(
  supabase: Service,
  input: {
    ownerId: string;
    seriesId: string;
    row: { id: string; name: string; locked: boolean };
    entry: PropEntry;
  },
): Promise<{ error?: string }> {
  if (input.row.locked) return { error: "That object is already on screen." };
  if (!input.entry.still_asset_id) return { error: "That object has no picture yet. Build or upload one first." };
  const kind = input.entry.kind ?? propKindFor(input.row.name);
  const assetId = await materialize(supabase, {
    ownerId: input.ownerId,
    seriesId: input.seriesId,
    sourceAssetId: input.entry.still_asset_id,
    // The engine finds a cached object by this key, so a reused still has to
    // carry the key this show's own planner would have written.
    metadata: {
      kind: "prop",
      prop: kind ?? input.row.name,
      key: propAssetKey(input.row.name),
      state: input.entry.state ?? null,
      name: input.row.name,
    },
  });
  if (!assetId) return { error: "Could not use that object." };

  await supabase
    .from("series_props")
    .update({
      prop_id: input.entry.id,
      still_asset_id: assetId,
      kind,
      state: input.entry.state ?? null,
      status: "ready",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.row.id);
  return {};
}
