import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rooms the buyer approved, so the story writes scenes in the sets we built.
 * A room whose plate exists comes first; the story is free to add one more.
 */
export async function approvedLocations(client: SupabaseClient, seriesId: string): Promise<string[]> {
  const { data, error } = await client
    .from("series_locations")
    .select("name, status, plate_asset_id, position")
    .eq("series_id", seriesId)
    .order("position");
  // A show that predates the design screen has no rows; the story names its own.
  if (error) return [];
  const rows = data ?? [];
  const built = rows.filter((row) => row.plate_asset_id || row.status === "ready");
  return (built.length ? built : rows).map((row) => String(row.name).trim()).filter(Boolean);
}

/**
 * Mirrors the rooms the shoot has locked onto the design screen.
 *
 * `series.location_refs` is the shoot's own map of location name to plate, and
 * it is the key the scene matcher reads. This copies it into `series_locations`
 * so a room the story wrote shows up beside the rooms the buyer approved,
 * already marked locked — its plate is in footage now and must not change.
 */
export async function syncDesignLocations(client: SupabaseClient, seriesId: string): Promise<void> {
  const { data: series } = await client
    .from("series")
    .select("location_refs")
    .eq("id", seriesId)
    .maybeSingle();
  const refs = (series?.location_refs ?? {}) as Record<string, unknown>;
  const names = Object.keys(refs).filter((name) => name.trim() && refs[name]);
  if (!names.length) return;

  const { data: rows } = await client
    .from("series_locations")
    .select("id, name, plate_asset_id, status, locked")
    .eq("series_id", seriesId);
  const byName = new Map((rows ?? []).map((row) => [String(row.name).trim().toLowerCase(), row]));
  const now = new Date().toISOString();
  let position = rows?.length ?? 0;

  for (const name of names) {
    const plateId = String(refs[name]);
    const existing = byName.get(name.trim().toLowerCase());
    if (!existing) {
      await client.from("series_locations").insert({
        series_id: seriesId,
        name,
        origin: "story",
        position: position++,
        plate_asset_id: plateId,
        status: "ready",
        locked: true,
        updated_at: now,
      });
      continue;
    }
    if (existing.plate_asset_id === plateId && existing.status === "ready" && existing.locked) continue;
    await client
      .from("series_locations")
      .update({ plate_asset_id: plateId, status: "ready", locked: true, error: null, updated_at: now })
      .eq("id", existing.id);
  }
}
