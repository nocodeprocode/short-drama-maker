import type { SupabaseClient } from "@supabase/supabase-js";

export type CastSlot = { name: string; note?: string; actor_id: string | null };

/**
 * Who the buyer cast on this show before the story existed. Passed into
 * `analyze` so the bible uses those role names and those faces.
 */
export async function castPlan(client: SupabaseClient, seriesId: string): Promise<CastSlot[]> {
  const { data, error } = await client
    .from("series_cast")
    .select("role_name, role_note, actor_id")
    .eq("series_id", seriesId)
    .order("created_at");
  // A show cast through the older per-character flow has no slots; that is not
  // an error, it just means the story is free to name its own parts.
  if (error) return [];
  return (data ?? []).map((row) => ({
    name: String(row.role_name),
    note: String(row.role_note ?? "") || undefined,
    actor_id: row.actor_id ? String(row.actor_id) : null,
  }));
}

/**
 * Links each cast slot to the character that now carries its role name, and
 * pushes the chosen actor onto that character. A locked role keeps the face it
 * already shot with.
 */
export async function bindCastPlan(client: SupabaseClient, seriesId: string): Promise<void> {
  const [{ data: slots }, { data: characters }] = await Promise.all([
    client.from("series_cast").select("id, role_name, actor_id, character_id").eq("series_id", seriesId),
    client.from("characters").select("id, name, actor_id, locked, visual_profile").eq("series_id", seriesId),
  ]);
  if (!slots?.length || !characters?.length) return;
  const byName = new Map(characters.map((row) => [String(row.name).trim().toLowerCase(), row]));
  const now = new Date().toISOString();

  for (const slot of slots) {
    const character = byName.get(String(slot.role_name).trim().toLowerCase());
    if (!character) continue;
    if (slot.character_id !== character.id) {
      await client.from("series_cast").update({ character_id: character.id, updated_at: now }).eq("id", slot.id);
    }
    if (!slot.actor_id || character.locked || character.actor_id === slot.actor_id) continue;

    const { data: actor } = await client
      .from("actors")
      .select("visual_reference_asset_ids")
      .eq("id", slot.actor_id)
      .maybeSingle();
    const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
    await client
      .from("characters")
      .update({
        actor_id: slot.actor_id,
        visual_profile: {
          ...visual,
          visual_reference_asset_ids: {
            ...((visual.visual_reference_asset_ids as Record<string, unknown> | undefined) ?? {}),
            ...((actor?.visual_reference_asset_ids ?? {}) as Record<string, unknown>),
          },
        },
        updated_at: now,
      })
      .eq("id", character.id);
  }
}
