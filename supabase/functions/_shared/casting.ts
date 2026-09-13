import type { Service } from "./productions.ts";

export type CastSlotRow = {
  id: string;
  series_id: string;
  actor_id: string | null;
  character_id: string | null;
  role_name: string;
  role_note: string;
  created_at: string;
  updated_at: string;
};

/**
 * A cast slot is "who plays this role on this show". It exists before the story
 * names its roles, so the buyer can cast a draft, and it binds to the character
 * once `analyze` writes one with a matching name.
 */
export function presentCastSlot(
  row: CastSlotRow,
  extras: {
    actor?: { id: string; name: string; source?: string; still_url?: string | null } | null;
    character?: { id: string; name: string; locked?: boolean; still_url?: string | null } | null;
  } = {},
) {
  return {
    id: row.id,
    series_id: row.series_id,
    role_name: row.role_name,
    role_note: row.role_note ?? "",
    actor_id: row.actor_id,
    actor_name: extras.actor?.name ?? null,
    actor_source: extras.actor?.source ?? null,
    actor_still_url: extras.actor?.still_url ?? null,
    character_id: row.character_id,
    character_still_url: extras.character?.still_url ?? null,
    locked: Boolean(extras.character?.locked),
    /** No actor means the run invents this face. */
    mode: row.actor_id ? "actor" : "generate",
  };
}

export function normalizeRoleName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function normalizeTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of list) {
    const tag = String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

/**
 * Binds every slot to the character that shares its role name, and copies the
 * chosen actor onto that character. Runs after the story names its roles, and
 * again whenever the cast screen is opened, so a slot the writer has caught up
 * with stops looking unassigned.
 */
export async function bindCastPlan(supabase: Service, seriesId: string) {
  const [{ data: slots }, { data: characters }] = await Promise.all([
    supabase.from("series_cast").select("*").eq("series_id", seriesId),
    supabase.from("characters").select("id, name, actor_id, locked, visual_profile").eq("series_id", seriesId),
  ]);
  if (!slots?.length || !characters?.length) return;

  const byName = new Map(characters.map((row) => [String(row.name).trim().toLowerCase(), row]));
  for (const slot of slots as CastSlotRow[]) {
    const character = byName.get(slot.role_name.trim().toLowerCase());
    if (!character) continue;
    if (slot.character_id !== character.id) {
      await supabase
        .from("series_cast")
        .update({ character_id: character.id, updated_at: new Date().toISOString() })
        .eq("id", slot.id);
    }
    // A locked role keeps the face it shot with; recasting it mid-run would
    // break identity on every take already in the can.
    if (slot.actor_id && !character.locked && character.actor_id !== slot.actor_id) {
      await castActorOnCharacter(supabase, character.id, slot.actor_id);
    }
  }
}

/**
 * Points a character at an actor and merges the actor's face refs in, so the
 * next still, wardrobe pass, and take all use that face.
 */
export async function castActorOnCharacter(supabase: Service, characterId: string, actorId: string) {
  const [{ data: character }, { data: actor }] = await Promise.all([
    supabase.from("characters").select("id, visual_profile").eq("id", characterId).maybeSingle(),
    supabase.from("actors").select("id, visual_reference_asset_ids").eq("id", actorId).maybeSingle(),
  ]);
  if (!character || !actor) return;
  const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
  const next = {
    ...visual,
    visual_reference_asset_ids: {
      ...((visual.visual_reference_asset_ids as Record<string, unknown> | undefined) ?? {}),
      ...((actor.visual_reference_asset_ids ?? {}) as Record<string, unknown>),
    },
  };
  await supabase
    .from("characters")
    .update({ actor_id: actorId, visual_profile: next, updated_at: new Date().toISOString() })
    .eq("id", characterId);
}

/** Role names the story must use, so a cast draft survives the writer. */
export async function requiredCastFor(supabase: Service, seriesId: string) {
  const { data } = await supabase
    .from("series_cast")
    .select("role_name, role_note, actor_id")
    .eq("series_id", seriesId)
    .order("created_at");
  return (data ?? []).map((row) => ({
    name: String(row.role_name),
    note: String(row.role_note ?? ""),
    actor_id: row.actor_id ? String(row.actor_id) : null,
  }));
}
