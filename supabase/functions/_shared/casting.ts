import type { Service } from "./productions.ts";
import {
  isStoryDevice,
  JOB_LABELS,
  parseSlateGender,
  personName,
  slotDisplayName,
  type CharacterJob,
  type SlateGender,
} from "./slate.ts";

export type CastSlotRow = {
  id: string;
  series_id: string;
  actor_id: string | null;
  character_id: string | null;
  role_name: string | null;
  role_note: string;
  job?: string | null;
  archetype?: string | null;
  importance?: string | null;
  castable?: boolean;
  suggested_name?: string | null;
  suggested_gender?: string | null;
  position?: number;
  origin?: string | null;
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
    actor?: {
      id: string;
      name: string;
      source?: string;
      still_url?: string | null;
      status?: string;
      error?: string | null;
      progress?: { done: number; total: number };
    } | null;
    character?: { id: string; name: string; locked?: boolean; still_url?: string | null } | null;
  } = {},
) {
  const job = row.job === "engine" || row.job === "wall" || row.job === "witness" || row.job === "nuke" ? row.job : null;
  const jobLabel = job ? JOB_LABELS[job] : null;
  const named = Boolean(personName(row) || extras.character?.name);
  const gender = parseSlateGender(row.suggested_gender);
  const display = slotDisplayName({
    role_name: row.role_name || extras.character?.name || null,
    suggested_name: row.suggested_name,
    archetype: row.archetype,
    label: jobLabel,
    castable: row.castable !== false,
  });
  return {
    id: row.id,
    series_id: row.series_id,
    role_name: row.role_name,
    display_name: display,
    role_note: row.role_note ?? "",
    job,
    job_label: jobLabel,
    archetype: row.archetype ?? "",
    importance: row.importance === "lead" || row.importance === "background" ? row.importance : "supporting",
    castable: row.castable !== false,
    named,
    suggested_name: row.suggested_name ?? null,
    suggested_gender: gender,
    origin: row.origin === "slate" ? "slate" : "buyer",
    actor_id: row.actor_id,
    actor_name: extras.actor?.name ?? null,
    actor_source: extras.actor?.source ?? null,
    actor_still_url: extras.actor?.still_url ?? null,
    actor_status: extras.actor?.status ?? null,
    actor_error: extras.actor?.error ?? null,
    actor_progress: extras.actor?.progress ?? null,
    character_id: row.character_id,
    character_still_url: extras.character?.still_url ?? null,
    locked: Boolean(extras.character?.locked),
    /** No actor means the run invents this face. */
    mode: row.actor_id ? "actor" : "generate",
  };
}

export function slotActorName(row: Pick<CastSlotRow, "role_name" | "suggested_name">): string {
  return personName(row).slice(0, 60);
}

export function asJob(value: unknown): CharacterJob | null {
  return value === "engine" || value === "wall" || value === "witness" || value === "nuke" ? value : null;
}

export function inferSlotGender(slot: CastSlotRow): SlateGender | null {
  const fromCol = parseSlateGender(slot.suggested_gender);
  if (fromCol) return fromCol;
  const hay = `${slot.role_note ?? ""} ${slot.archetype ?? ""} ${slot.role_name ?? ""} ${slot.suggested_name ?? ""}`.toLowerCase();
  const woman = /\b(woman|female|girl|lady|wife|mother|sister|daughter|she|her|luna|omega|bride|maid)\b/.test(hay);
  const man = /\b(man|male|boy|gentleman|husband|father|brother|son|he|him|his|alpha|don|prince)\b/.test(hay);
  if (woman && !man) return "woman";
  if (man && !woman) return "man";
  return null;
}

function personLook(name: string, gender: SlateGender, jobLabel: string | null, note: string): string {
  const who = jobLabel ? `${name}, adult ${gender}, ${jobLabel}` : `${name}, adult ${gender}`;
  const brief = note.trim();
  return `${who}. ${brief ? `${brief}. ` : ""}Photoreal adult human. A real person, not an object, document, cartoon, or mascot.`;
}

/**
 * Creates a generated actor for each missing castable slot and attaches it.
 * Locked and device slots are skipped. The caller enqueues generate_actor.
 */
export async function generateMissingFaces(
  supabase: Service,
  input: { ownerId: string; seriesId: string; slotIds?: string[] },
): Promise<{ created: Array<{ actorId: string; slot: CastSlotRow }>; unnamed: number }> {
  const [{ data: slots }, { data: characters }] = await Promise.all([
    supabase.from("series_cast").select("*").eq("series_id", input.seriesId).order("position"),
    supabase.from("characters").select("id, locked").eq("series_id", input.seriesId),
  ]);
  const locked = new Set((characters ?? []).filter((row) => row.locked).map((row) => String(row.id)));
  const wanted = input.slotIds?.length ? new Set(input.slotIds) : null;
  let unnamed = 0;
  const targets = ((slots ?? []) as CastSlotRow[]).filter((row) => {
    const job = asJob(row.job);
    if (row.castable === false || (job && isStoryDevice(job, String(row.archetype ?? "")))) return false;
    if (row.actor_id) return false;
    if (row.character_id && locked.has(String(row.character_id))) return false;
    if (wanted && !wanted.has(String(row.id))) return false;
    if (!personName(row) || !inferSlotGender(row)) {
      unnamed += 1;
      return false;
    }
    return true;
  });

  const now = new Date().toISOString();
  const created: Array<{ actorId: string; slot: CastSlotRow }> = [];
  for (const slot of targets) {
    const name = slotActorName(slot);
    const gender = inferSlotGender(slot);
    if (!name || !gender) {
      unnamed += 1;
      continue;
    }
    const job = asJob(slot.job);
    const jobTag = job ? JOB_LABELS[job] : null;
    const note = String(slot.role_note || "").slice(0, 600);
    const look = personLook(name, gender, jobTag, note);
    const { data: actor, error } = await supabase
      .from("actors")
      .insert({
        owner_id: input.ownerId,
        name,
        source: "generated",
        tags: normalizeTags([jobTag, gender, "generated"]),
        notes: look.slice(0, 600),
        identity_fidelity: "faithful",
        appearance_profile: {
          age_look: "adult",
          ethnicity_notes: "",
          hair: "",
          face: `adult ${gender}`,
          body: `adult ${gender}`,
          default_wardrobe: "",
        },
      })
      .select("*")
      .single();
    if (error || !actor) throw new Error(error?.message ?? "Could not generate a face.");
    const { data: saved, error: slotError } = await supabase
      .from("series_cast")
      .update({ actor_id: actor.id, updated_at: now })
      .eq("id", slot.id)
      .select("*")
      .single();
    if (slotError || !saved) throw new Error(slotError?.message ?? "Could not attach the face.");
    if (slot.character_id && !locked.has(String(slot.character_id))) {
      await castActorOnCharacter(supabase, String(slot.character_id), String(actor.id));
    }
    created.push({ actorId: String(actor.id), slot: saved as CastSlotRow });
  }
  return { created, unnamed };
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
  const claimed = new Set<string>();
  for (const slot of slots as CastSlotRow[]) {
    let character = slot.role_name ? byName.get(slot.role_name.trim().toLowerCase()) : undefined;
    if (!character && slot.job) {
      character = (characters ?? []).find((row) => {
        const visual = (row.visual_profile ?? {}) as Record<string, unknown>;
        const personality = (visual.personality_profile ?? {}) as Record<string, unknown>;
        return personality.job === slot.job && !claimed.has(String(row.id));
      });
    }
    if (!character) continue;
    claimed.add(String(character.id));
    if (!slot.role_name) {
      await supabase
        .from("series_cast")
        .update({ role_name: character.name, character_id: character.id, updated_at: new Date().toISOString() })
        .eq("id", slot.id);
    } else if (slot.character_id !== character.id) {
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
    .select("role_name, role_note, actor_id, job, suggested_name, archetype, importance, castable")
    .eq("series_id", seriesId)
    .order("position");
  return (data ?? []).flatMap((row) => {
    if (row.castable === false) return [];
    const name = personName(row);
    if (!name) return [];
    return [
      {
        name,
        note: String(row.role_note ?? ""),
        actor_id: row.actor_id ? String(row.actor_id) : null,
        job: row.job === "engine" || row.job === "wall" || row.job === "witness" || row.job === "nuke" ? row.job : null,
        importance:
          row.importance === "lead" || row.importance === "background" ? row.importance : "supporting",
      },
    ];
  });
}
