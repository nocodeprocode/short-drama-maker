import type { GenreId } from "../../types/genre.ts";
import { MUSIC_LIBRARY } from "../../types/audio.ts";

export type BedMood = "thriller" | "romance" | "estate" | "tension";

export const BED_MOODS: readonly BedMood[] = ["thriller", "romance", "estate", "tension"];

/** Default bed per genre when the scene gives no stronger signal. */
const GENRE_BED: Record<GenreId, BedMood> = {
  billionaire: "estate",
  werewolf: "thriller",
  mafia: "thriller",
  rebirth: "romance",
  revenge: "thriller",
  workplace_cinderella: "romance",
  legal_medical: "tension",
  costume: "estate",
  hidden_identity: "tension",
};

const ROMANCE_EMOTION = /\b(tender|longing|soft|love|warm|ache|yearn|intimate|kiss)\b/i;
const TENSION_EMOTION = /\b(stun|stunned|shock|dread|cold|quiet|unpaid|frozen|waiting|held breath|fear)\b/i;
const THRILLER_EMOTION = /\b(hot|fury|rage|pressing|accus|threat|danger|hunt|run|slap)\b/i;

export type MoodInput = {
  genre?: GenreId | null;
  /** Editorial scene kind from scene-groups: recap | dialogue | evidence | button. */
  sceneKind?: string | null;
  /** Emotions of the shots in this scene, in order. */
  emotions?: Array<string | null | undefined>;
  /** Location line; night/estate settings lean into the estate bed. */
  location?: string | null;
  time?: string | null;
};

/**
 * Scene-level bed choice. Deterministic and explainable: the button always
 * tightens to tension, evidence beats hold the genre bed, dialogue follows the
 * dominant emotion, and the genre decides ties.
 */
export function musicMoodForScene(input: MoodInput): BedMood {
  const genreBed = GENRE_BED[input.genre ?? "billionaire"];
  if (input.sceneKind === "button") return "tension";
  if (input.sceneKind === "recap") return genreBed;
  const emotions = (input.emotions ?? []).filter((row): row is string => Boolean(row)).join(" ");
  let romance = 0;
  let tension = 0;
  let thriller = 0;
  for (const word of emotions.split(/[\s,/]+/)) {
    if (ROMANCE_EMOTION.test(word)) romance += 1;
    if (TENSION_EMOTION.test(word)) tension += 1;
    if (THRILLER_EMOTION.test(word)) thriller += 1;
  }
  const top = Math.max(romance, tension, thriller);
  if (top === 0) {
    if (/\b(estate|manor|penthouse|gala|ballroom|terrace)\b/i.test(input.location ?? "") || /night/i.test(input.time ?? "")) {
      return genreBed === "thriller" ? "estate" : genreBed;
    }
    return genreBed;
  }
  if (romance === top) return "romance";
  if (tension === top) return "tension";
  return "thriller";
}

/** Choose a bed for the next scene that differs from the previous one when the library allows. */
export function nextBedMood(preferred: BedMood, previous: BedMood | null): BedMood {
  if (!previous || preferred !== previous) return preferred;
  const available = BED_MOODS.filter((mood) => MUSIC_LIBRARY.some((entry) => entry.kind === "bed" && entry.mood === mood));
  // Same mood twice in a row: fall back to the closest neighbour so a 15-minute
  // episode does not loop one stem for a quarter of an hour.
  const neighbours: Record<BedMood, BedMood[]> = {
    thriller: ["tension", "estate"],
    tension: ["thriller", "estate"],
    estate: ["tension", "romance"],
    romance: ["estate", "tension"],
  };
  return neighbours[preferred].find((mood) => available.includes(mood)) ?? preferred;
}
