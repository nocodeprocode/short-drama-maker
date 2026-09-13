import { inferGenre, playbookFor } from "../../drama-engine/craft/genre-playbooks.ts";
import type { CharacterJob, GenreId } from "../../drama-engine/types/genre.ts";
import { SEASON_CAST_MAX, SEASON_CAST_MIN } from "../../drama-engine/plans/season-bible.ts";

export { inferGenre };
export type { CharacterJob };

export type CastImportance = "lead" | "supporting" | "background";
export type SlateOrigin = "slate" | "buyer";

export type CastSlateSlot = {
  job: CharacterJob;
  label: string;
  archetype: string;
  importance: CastImportance;
  castable: boolean;
  position: number;
};

export const JOB_LABELS: Record<CharacterJob, string> = {
  engine: "Lead",
  wall: "Antagonist",
  witness: "Confidant",
  nuke: "Disruptor",
};

export const JOB_IMPORTANCE: Record<CharacterJob, CastImportance> = {
  engine: "lead",
  wall: "lead",
  witness: "supporting",
  nuke: "supporting",
};

export const JOBS_BY_POSITION: CharacterJob[] = ["engine", "wall", "witness", "nuke"];

/** A speaking role, not a status word like "heir" that often sits next to a document. */
const SPEAKING_PERSON_NEEDLE =
  /\b(luna|wife|secretary|ceo|alpha|beta|doctor|lawyer|nanny|don|driver|priest|twin|owner|specialist|bride|servant|prince|patient|client|assistant|villain|keeper|woman|man|person|sister|brother|mother|father|husband|girl|boy|omega|intern|cleaner|maid|kidnapped)\b/i;
const DEVICE_NEEDLE = /\b(nda|dna|edict|token|clause|mark|sheet|locket|test|deed|ledger)\b/i;
const LEAD_REVEAL_NEEDLE = /\b(she'?s the owner|she wrote|he wrote|she is the)\b/i;

export type SlateGender = "woman" | "man";

/** A nuke that is a planted object or a twist about the lead, not a new speaking person. */
export function isStoryDevice(job: CharacterJob, archetype: string): boolean {
  if (job !== "nuke") return false;
  if (LEAD_REVEAL_NEEDLE.test(archetype)) return true;
  const hasDevice = DEVICE_NEEDLE.test(archetype);
  const hasSpeakingPerson = SPEAKING_PERSON_NEEDLE.test(archetype);
  // "true-mate mark / kidnapped Luna" is a person. "hidden heir / leaked NDA" is the document.
  if (hasDevice && hasSpeakingPerson) return false;
  if (hasDevice) return true;
  return !hasSpeakingPerson && !/\bheir\b/i.test(archetype);
}

export function parseSlateGender(value: unknown): SlateGender | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "woman" || raw === "female") return "woman";
  if (raw === "man" || raw === "male") return "man";
  return null;
}

export function personName(slot: { role_name?: string | null; suggested_name?: string | null }): string {
  return String(slot.role_name || slot.suggested_name || "").trim();
}

export function jobFromPosition(index: number): CharacterJob {
  return JOBS_BY_POSITION[index] ?? "witness";
}

export function buildCastSlate(input: { title?: string; idea?: string; genre?: GenreId }): CastSlateSlot[] {
  const genre = input.genre ?? inferGenre(`${input.title ?? ""} ${input.idea ?? ""}`);
  const playbook = playbookFor(genre);
  const slots: CastSlateSlot[] = [];
  for (const [index, archetype] of playbook.requiredArchetypes.entries()) {
    if (slots.length >= SEASON_CAST_MAX) break;
    slots.push({
      job: archetype.job,
      label: JOB_LABELS[archetype.job],
      archetype: archetype.role,
      importance: JOB_IMPORTANCE[archetype.job],
      castable: !isStoryDevice(archetype.job, archetype.role),
      position: index,
    });
  }
  if (slots.length < SEASON_CAST_MIN) {
    for (const job of JOBS_BY_POSITION) {
      if (slots.length >= SEASON_CAST_MIN) break;
      if (slots.some((slot) => slot.job === job)) continue;
      slots.push({
        job,
        label: JOB_LABELS[job],
        archetype: job,
        importance: JOB_IMPORTANCE[job],
        castable: true,
        position: slots.length,
      });
    }
  }
  return slots;
}

export function slotDisplayName(slot: {
  role_name?: string | null;
  suggested_name?: string | null;
  archetype?: string | null;
  label?: string | null;
  castable?: boolean;
}): string {
  const named = personName(slot);
  if (named) return named;
  if (slot.castable === false) return (slot.archetype || slot.label || "Story element").trim();
  const label = String(slot.label ?? "").trim();
  return label ? `Unnamed ${label}` : "Unnamed part";
}
