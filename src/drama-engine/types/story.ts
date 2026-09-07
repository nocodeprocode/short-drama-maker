import type { CharacterJob, GenreId, SkuPolicy } from "./genre.ts";

export type CliffhangerType =
  | "information"
  | "danger"
  | "romantic"
  | "humiliation"
  | "identity"
  | "choice"
  | "interruption";

export type EpisodeKind =
  | "HookEp"
  | "RevealEp"
  | "ConfrontationEp"
  | "CliffhangerEp"
  | "ComfortEp"
  | "TentpoleEp";

export type CliffhangerVisual = "freeze_face" | "smash_black" | "insert_then_face" | "doorway" | "phone";

export type CliffhangerRule = {
  type: CliffhangerType;
  placementMsFromEnd: { min: 2000; max: 10000; preferred: 5000 };
  visual: CliffhangerVisual;
  audioStinger: boolean;
  unresolvedQuestion: string;
  muteReadable: boolean;
};

export type HookLedgerEntry = {
  id: string;
  openedEp: number;
  closedEp?: number;
  stakeRank: number;
  type: CliffhangerType;
  question: string;
};

export type CastConstraint = {
  namedSpeakingMin: 3;
  namedSpeakingMax: 8;
  everyNamedHasJob: true;
};

export const CAST_CONSTRAINT: CastConstraint = {
  namedSpeakingMin: 3,
  namedSpeakingMax: 8,
  everyNamedHasJob: true,
};

export type PaywallRule = {
  freeEpisodes: { min: number; max: number };
  lastFreeMustBe: "CliffhangerEp";
  strongestOfSeasonSoFar: true;
  romanceHintAfterFirstKiss: boolean;
};

export const DEFAULT_PAYWALL: PaywallRule = {
  freeEpisodes: { min: 8, max: 12 },
  lastFreeMustBe: "CliffhangerEp",
  strongestOfSeasonSoFar: true,
  romanceHintAfterFirstKiss: true,
};

export type NamedCastMember = {
  name: string;
  job: CharacterJob;
};

export type SeasonCraft = {
  genre_id: GenreId;
  sku_policy: SkuPolicy;
  hook_ledger: HookLedgerEntry[];
  paywall: PaywallRule;
  tentpoles: number[];
  cast: NamedCastMember[];
};

export const DEFAULT_TENTPOLES = [1, 3, 5, 10] as const;

export function episodeKindFor(episodeNumber: number): EpisodeKind {
  if (episodeNumber === 1) return "HookEp";
  if (episodeNumber === 2) return "RevealEp";
  if (episodeNumber === 3 || episodeNumber === 5 || episodeNumber === 10) return "TentpoleEp";
  if (episodeNumber % 5 === 0) return "ConfrontationEp";
  if (episodeNumber % 3 === 0) return "CliffhangerEp";
  if (episodeNumber % 4 === 0) return "ComfortEp";
  return "RevealEp";
}
