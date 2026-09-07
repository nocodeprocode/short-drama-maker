import type { EpisodeLength } from "../../engine/config/catalog.ts";
import type { StoryBible } from "../../engine/domain.ts";
import { inferGenre, playbookFor } from "../craft/genre-playbooks.ts";
import { DEFAULT_PAYWALL, DEFAULT_TENTPOLES, episodeKindFor, type HookLedgerEntry, type SeasonCraft } from "../types/story.ts";
import type { SkuPolicy } from "../types/genre.ts";

export function buildSeasonCraft(input: {
  bible: StoryBible;
  idea?: string;
  skuPolicy?: SkuPolicy;
  episodeCount?: number;
}): SeasonCraft {
  const genre = inferGenre(`${input.bible.title} ${input.bible.logline} ${input.idea ?? ""}`);
  const playbook = playbookFor(genre);
  const cast = input.bible.characters.map((character, index) => ({
    name: character.name,
    job: playbook.requiredArchetypes[index]?.job ?? (index === 0 ? "engine" : index === 1 ? "wall" : "witness"),
  }));
  const hook_ledger: HookLedgerEntry[] = (input.bible.episode_structure ?? []).slice(0, 3).map((ep, i) => ({
    id: `hook-${ep.episode_number}`,
    openedEp: ep.episode_number,
    stakeRank: i + 1,
    type: i === 0 ? "identity" : "information",
    question: ep.hook || ep.conflict,
  }));
  return {
    genre_id: genre,
    sku_policy: input.skuPolicy ?? playbook.skuPolicy[0] ?? "en_iap",
    hook_ledger,
    paywall: DEFAULT_PAYWALL,
    tentpoles: [...DEFAULT_TENTPOLES],
    cast,
  };
}

export function recapAllowed(episodeNumber: number): boolean {
  return episodeNumber >= 2;
}

export function recapBudgetSeconds(episodeNumber: number): number {
  return recapAllowed(episodeNumber) ? 4 : 0;
}

export function lastFreeEpisode(episodeCount: number): number {
  const max = DEFAULT_PAYWALL.freeEpisodes.max;
  const min = DEFAULT_PAYWALL.freeEpisodes.min;
  return Math.min(max, Math.max(min, Math.min(episodeCount, 10)));
}

export function tentpoleAt(episodeNumber: number): boolean {
  return DEFAULT_TENTPOLES.includes(episodeNumber as (typeof DEFAULT_TENTPOLES)[number]) ||
    episodeNumber % 5 === 0;
}

export function enrichEpisodeStructure(bible: StoryBible) {
  return (bible.episode_structure ?? []).map((row) => ({
    ...row,
    type: row.type ?? episodeKindFor(row.episode_number),
    cliffhanger: row.cliffhanger ?? row.conflict,
    tentpole: row.tentpole ?? tentpoleAt(row.episode_number),
    paywall_flag: row.paywall_flag ?? row.episode_number === lastFreeEpisode(bible.episode_structure.length),
  }));
}

export * from "./long-form.ts";
export * from "./lock-slice.ts";
export * from "./season-bible.ts";

export function plannerLength(length: EpisodeLength | undefined): EpisodeLength {
  return length ?? "60_90";
}

export function ledgerForEpisode(episodeNumber: number): {
  hookLedgerCloses: number;
  hookLedgerOpens: number;
} {
  return {
    hookLedgerOpens: 1,
    hookLedgerCloses: episodeNumber >= 2 ? 1 : 0,
  };
}
