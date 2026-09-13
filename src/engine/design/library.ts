import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything a show builds also lands in the owner's catalog, so the next show
 * can shoot the same room and the same object instead of paying to invent them
 * again and getting a different penthouse both times.
 *
 * This is the runner's half of `supabase/functions/_shared/library.ts`. Only the
 * two writes the shoot performs live here; the reading and attaching stay in the
 * edge function, which is the only side that serves the catalog pages.
 */

/** Catalogs a plate a show just built, and points the show's row at the entry. */
export async function catalogueLocation(
  client: SupabaseClient,
  input: {
    ownerId: string;
    rowId: string;
    name: string;
    plateAssetId: string;
    lightingLock?: string | null;
  },
): Promise<void> {
  const name = input.name.trim();
  if (!name || !input.plateAssetId) return;
  const entryId = await upsertEntry(client, {
    table: "locations",
    ownerId: input.ownerId,
    name,
    imageColumn: "plate_asset_id",
    imageId: input.plateAssetId,
    extra: { lighting_lock: input.lightingLock ?? null },
  });
  if (entryId) {
    await client.from("series_locations").update({ location_id: entryId }).eq("id", input.rowId);
  }
}

export async function catalogueProp(
  client: SupabaseClient,
  input: {
    ownerId: string;
    rowId: string;
    name: string;
    stillAssetId: string;
    kind?: string | null;
    state?: string | null;
  },
): Promise<void> {
  const name = input.name.trim();
  if (!name || !input.stillAssetId) return;
  const entryId = await upsertEntry(client, {
    table: "props",
    ownerId: input.ownerId,
    name,
    imageColumn: "still_asset_id",
    imageId: input.stillAssetId,
    extra: { kind: input.kind ?? null, state: input.state ?? null },
  });
  if (entryId) {
    await client.from("series_props").update({ prop_id: entryId }).eq("id", input.rowId);
  }
}

/**
 * One entry per name per owner. An entry that already has a picture keeps it —
 * the catalog is what makes two shows look the same, so the second show must not
 * quietly repoint it at a new image.
 */
async function upsertEntry(
  client: SupabaseClient,
  input: {
    table: "locations" | "props";
    ownerId: string;
    name: string;
    imageColumn: "plate_asset_id" | "still_asset_id";
    imageId: string;
    extra: Record<string, unknown>;
  },
): Promise<string | null> {
  const now = new Date().toISOString();
  const { data: existing } = await client
    .from(input.table)
    .select(`id, ${input.imageColumn}`)
    .eq("owner_id", input.ownerId)
    .ilike("name", input.name)
    .maybeSingle();

  if (existing) {
    const row = existing as Record<string, unknown>;
    if (!row[input.imageColumn]) {
      await client
        .from(input.table)
        .update({
          [input.imageColumn]: input.imageId,
          ...input.extra,
          status: "ready",
          error: null,
          updated_at: now,
        })
        .eq("id", String(row.id));
    }
    return String(row.id);
  }

  const { data, error } = await client
    .from(input.table)
    .insert({
      owner_id: input.ownerId,
      name: input.name,
      source: "generated",
      [input.imageColumn]: input.imageId,
      ...input.extra,
      status: "ready",
    })
    .select("id")
    .single();
  // A race with another task that catalogued the same name is not a failure;
  // the show's own row is already correct either way.
  if (error || !data) return null;
  return String(data.id);
}
