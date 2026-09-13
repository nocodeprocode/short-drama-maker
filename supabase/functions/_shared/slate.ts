/**
 * Cast slate for a brief. Kept in lockstep with src/engine/casting/slate.ts
 * (parity: src/lib/slate-parity.test.ts). Edge functions cannot import the
 * drama-engine playbooks, so the genre table and inference live here too.
 */

export type CharacterJob = "engine" | "wall" | "witness" | "nuke";
export type CastImportance = "lead" | "supporting" | "background";
export type SlateOrigin = "slate" | "buyer";
export type GenreId =
  | "billionaire"
  | "werewolf"
  | "revenge"
  | "hidden_identity"
  | "mafia"
  | "rebirth"
  | "workplace_cinderella"
  | "legal_medical"
  | "costume";

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

export const SEASON_CAST_MIN = 4;
export const SEASON_CAST_MAX = 5;

/** A speaking role, not a status word like "heir" that often sits next to a document. */
const SPEAKING_PERSON_NEEDLE =
  /\b(luna|wife|secretary|ceo|alpha|beta|doctor|lawyer|nanny|don|driver|priest|twin|owner|specialist|bride|servant|prince|patient|client|assistant|villain|keeper|woman|man|person|sister|brother|mother|father|husband|girl|boy|omega|intern|cleaner|maid|kidnapped)\b/i;
const DEVICE_NEEDLE = /\b(nda|dna|edict|token|clause|mark|sheet|locket|test|deed|ledger)\b/i;
const LEAD_REVEAL_NEEDLE = /\b(she'?s the owner|she wrote|he wrote|she is the)\b/i;

export type SlateGender = "woman" | "man";

const GENRE_ARCHETYPES: Record<GenreId, Array<{ job: CharacterJob; role: string }>> = {
  billionaire: [
    { job: "engine", role: "contract wife / secretary" },
    { job: "wall", role: "CEO" },
    { job: "witness", role: "lawyer or assistant" },
    { job: "nuke", role: "hidden heir / leaked NDA" },
  ],
  werewolf: [
    { job: "engine", role: "omega / servant" },
    { job: "wall", role: "Alpha" },
    { job: "witness", role: "Beta" },
    { job: "nuke", role: "true-mate mark / kidnapped Luna" },
  ],
  revenge: [
    { job: "engine", role: "ledger keeper" },
    { job: "wall", role: "original villain" },
    { job: "witness", role: "public room that cannot leave" },
    { job: "nuke", role: "unfinished name on the ledger" },
  ],
  hidden_identity: [
    { job: "engine", role: "nobody who is somebody" },
    { job: "wall", role: "the person who should have known" },
    { job: "witness", role: "doctor / lawyer / nanny" },
    { job: "nuke", role: "test / locket / DNA sheet" },
  ],
  mafia: [
    { job: "engine", role: "debt / innocent" },
    { job: "wall", role: "don with a code" },
    { job: "witness", role: "driver or priest" },
    { job: "nuke", role: "rival family / blood choice" },
  ],
  rebirth: [
    { job: "engine", role: "reborn with the ledger" },
    { job: "wall", role: "the person who will harm her" },
    { job: "witness", role: "the one who died last life" },
    { job: "nuke", role: "crisis this life did not have" },
  ],
  workplace_cinderella: [
    { job: "engine", role: "invisible labor" },
    { job: "wall", role: "the executive" },
    { job: "witness", role: "the room that ignored her" },
    { job: "nuke", role: "she’s the owner / she wrote the clause" },
  ],
  legal_medical: [
    { job: "engine", role: "underestimated specialist" },
    { job: "wall", role: "the institution" },
    { job: "witness", role: "patient / client in the room" },
    { job: "nuke", role: "the clause / the deed" },
  ],
  costume: [
    { job: "engine", role: "discarded bride / servant" },
    { job: "wall", role: "prince / clan head" },
    { job: "witness", role: "court that laughed" },
    { job: "nuke", role: "edict / jade token / hidden bloodline" },
  ],
};

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

export function inferGenre(text: string): GenreId {
  const hay = text.toLowerCase();
  if (/\b(wolf|luna|alpha|pack|mate)\b/.test(hay)) return "werewolf";
  if (/\b(mafia|don|cartel)\b/.test(hay)) return "mafia";
  if (/\b(reborn|rebirth|second chance|last life)\b/.test(hay)) return "rebirth";
  if (/\b(revenge|regret this|you will pay)\b/.test(hay)) return "revenge";
  if (/\b(intern|badge|office|ceo secretary|cleaner)\b/.test(hay)) return "workplace_cinderella";
  if (/\b(lawyer|doctor|clause|hospital)\b/.test(hay)) return "legal_medical";
  if (/\b(dynasty|empress|edict|palace)\b/.test(hay)) return "costume";
  if (/\b(secret|hidden|dna|amnesia|baby)\b/.test(hay)) return "hidden_identity";
  return "billionaire";
}

export function buildCastSlate(input: { title?: string; idea?: string; genre?: GenreId }): CastSlateSlot[] {
  const genre = input.genre ?? inferGenre(`${input.title ?? ""} ${input.idea ?? ""}`);
  const archetypes = GENRE_ARCHETYPES[genre] ?? GENRE_ARCHETYPES.billionaire;
  const slots: CastSlateSlot[] = [];
  for (const [index, archetype] of archetypes.entries()) {
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
