import type { Service } from "./productions.ts";
import {
  buildCastSlate,
  isStoryDevice,
  jobFromPosition,
  JOB_IMPORTANCE,
  JOB_LABELS,
  type CharacterJob,
  type CastSlateSlot,
} from "./slate.ts";

type SlotRow = {
  id: string;
  series_id: string;
  actor_id: string | null;
  character_id: string | null;
  role_name: string | null;
  role_note: string;
  job: string | null;
  archetype: string | null;
  importance: string;
  castable: boolean;
  suggested_name: string | null;
  position: number;
  origin: string;
};

function asJob(value: unknown): CharacterJob | null {
  return value === "engine" || value === "wall" || value === "witness" || value === "nuke"
    ? value
    : null;
}

function bibleCharacters(bible: Record<string, unknown> | null | undefined) {
  const rows = Array.isArray(bible?.characters) ? (bible?.characters as Array<Record<string, unknown>>) : [];
  return rows.map((row, index) => {
    const personality = (row.personality ?? {}) as Record<string, unknown>;
    return {
      name: String(row.name ?? "").trim(),
      job: asJob(personality.job) ?? jobFromPosition(index),
      note: String(row.description ?? "").slice(0, 300),
    };
  });
}

/**
 * Makes sure a show has a structured slate. Safe to run on every cast-tab
 * open: existing buyer rows stay, locked characters are never rewritten, and
 * only missing jobs are inserted.
 */
export async function ensureCastSlate(
  supabase: Service,
  series: { id: string; title?: string | null; description?: string | null; story_bible?: Record<string, unknown> | null },
) {
  const [{ data: slots }, { data: characters }] = await Promise.all([
    supabase.from("series_cast").select("*").eq("series_id", series.id).order("created_at"),
    supabase.from("characters").select("id, name, locked, visual_profile").eq("series_id", series.id),
  ]);
  const existing = (slots ?? []) as SlotRow[];
  const now = new Date().toISOString();
  const fromBible = bibleCharacters(series.story_bible ?? null);
  const slate = buildCastSlate({ title: series.title ?? "", idea: series.description ?? "" });

  const takenJobs = new Set(existing.map((row) => asJob(row.job)).filter((job): job is CharacterJob => Boolean(job)));
  const takenNames = new Set(existing.map((row) => String(row.role_name ?? "").trim().toLowerCase()).filter(Boolean));

  // A stale "hidden heir / leaked NDA" row was marked castable because "heir"
  // looked like a person. Recompute so a document never stays a face slot.
  for (const row of existing) {
    const job = asJob(row.job);
    if (!job || row.origin !== "slate" || row.character_id) continue;
    const castable = !isStoryDevice(job, String(row.archetype ?? ""));
    if (castable === row.castable) continue;
    await supabase
      .from("series_cast")
      .update({ castable, updated_at: now })
      .eq("id", row.id);
    row.castable = castable;
  }

  // Stamp a job onto a buyer row that predates the slate columns.
  for (const [index, row] of existing.entries()) {
    if (row.job) continue;
    const character = (characters ?? []).find((item) => String(item.id) === String(row.character_id));
    const visual = (character?.visual_profile ?? {}) as Record<string, unknown>;
    const personality = (visual.personality_profile ?? {}) as Record<string, unknown>;
    const fromCharacter = asJob(personality.job);
    const fromName = fromBible.find((item) => item.name.toLowerCase() === String(row.role_name ?? "").trim().toLowerCase());
    const job = fromCharacter ?? fromName?.job ?? jobFromPosition(index);
    await supabase
      .from("series_cast")
      .update({
        job,
        importance: JOB_IMPORTANCE[job],
        archetype: row.archetype ?? slate.find((slot) => slot.job === job)?.archetype ?? JOB_LABELS[job],
        updated_at: now,
      })
      .eq("id", row.id);
    takenJobs.add(job);
  }

  const insertSlate = async (slot: CastSlateSlot, extras: { role_name?: string | null; character_id?: string | null; role_note?: string } = {}) => {
    if (takenJobs.has(slot.job)) return;
    if (extras.role_name && takenNames.has(extras.role_name.trim().toLowerCase())) {
      takenJobs.add(slot.job);
      return;
    }
    await supabase.from("series_cast").insert({
      series_id: series.id,
      actor_id: null,
      character_id: extras.character_id ?? null,
      role_name: extras.role_name ?? null,
      role_note: extras.role_note ?? "",
      job: slot.job,
      archetype: slot.archetype,
      importance: slot.importance,
      castable: slot.castable,
      suggested_name: extras.role_name ?? null,
      suggested_gender: null,
      position: slot.position,
      origin: "slate",
      updated_at: now,
    });
    takenJobs.add(slot.job);
    if (extras.role_name) takenNames.add(extras.role_name.trim().toLowerCase());
  };

  if (fromBible.length) {
    for (const [index, character] of fromBible.entries()) {
      const slot = slate.find((item) => item.job === character.job) ?? {
        ...slate[index],
        job: character.job,
        label: JOB_LABELS[character.job],
        archetype: character.name,
        importance: JOB_IMPORTANCE[character.job],
        castable: true,
        position: index,
      };
      const row = (characters ?? []).find((item) => String(item.name).trim().toLowerCase() === character.name.toLowerCase());
      await insertSlate(slot, {
        role_name: character.name,
        character_id: row ? String(row.id) : null,
        role_note: character.note,
      });
    }
    return;
  }

  // Hand-cast draft: keep those rows, add only the jobs nobody claimed.
  for (const slot of slate) {
    await insertSlate(slot);
  }
}
