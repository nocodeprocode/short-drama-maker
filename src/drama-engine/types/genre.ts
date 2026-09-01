export const GENRE_IDS = [
  "billionaire",
  "werewolf",
  "revenge",
  "hidden_identity",
  "mafia",
  "rebirth",
  "workplace_cinderella",
  "legal_medical",
  "costume",
] as const;

export type GenreId = (typeof GENRE_IDS)[number];

export type CharacterJob = "engine" | "wall" | "witness" | "nuke";

export type SkuPolicy = "en_iap" | "cn_iaa" | "latam_telenovela";

export type GenrePlaybook = {
  id: GenreId;
  title: string;
  premiseTemplate: string;
  storyDirection: string;
  requiredArchetypes: Array<{ job: CharacterJob; role: string }>;
  visualMotifs: string[];
  setPieces: string[];
  cliffPatterns: string[];
  punish: string[];
  skuPolicy: SkuPolicy[];
  tenBeats: string[];
};

export function isGenreId(value: unknown): value is GenreId {
  return typeof value === "string" && (GENRE_IDS as readonly string[]).includes(value);
}
