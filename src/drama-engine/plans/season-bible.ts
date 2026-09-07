import type { StoryBible } from "../../engine/domain.ts";
import { inferGenre, playbookFor } from "../craft/genre-playbooks.ts";
import type { GenreId } from "../types/genre.ts";
import { coreExpectationFrom, LOOP_SPINE, MICRO_PAYWALL_EPISODE, type LoopSpine } from "../types/micro-drama.ts";

export const SEASON_EPISODE_COUNT = 60;
export const SEASON_PAYWALL_EPISODE = MICRO_PAYWALL_EPISODE;
export const SEASON_ACTS = 4;
export const SEASON_ACT_LENGTH = 15;
export const TITLE_WORD_MIN = 4;
export const TITLE_WORD_MAX = 8;
export const SEASON_CAST_MIN = 4;
export const SEASON_CAST_MAX = 5;
export const SEASON_LOCATION_MIN = 3;
export const SEASON_LOCATION_MAX = 5;
export const PLANTED_GUN_COUNT = 3;

export type SeasonAct = {
  act: 1 | 2 | 3 | 4;
  episodes: [number, number];
  spine: string;
};

export type PlantedGun = {
  name: string;
  plant_ep: number;
  payoff_ep: number;
  note: string;
};

export type EpisodeLogLine = {
  episode_number: number;
  logline: string;
};

export type SeasonBible = {
  title: string;
  playbook_id: GenreId;
  core_expectation: string;
  acts: SeasonAct[];
  loops: LoopSpine[];
  paywall_episode: number;
  planted_guns: PlantedGun[];
  characters: string[];
  locations: string[];
  episode_log: EpisodeLogLine[];
};

const ACT_SPINES = [
  "Install the lie and the public cost",
  "Raise the price; the room starts to notice",
  "The evidence is public; love and name collide",
  "Paywall aftermath through the leftover nuke",
] as const;

function titleWords(title: string): number {
  return title.trim().split(/\s+/).filter(Boolean).length;
}

function tropeTitle(playbookTitle: string, given: string): string {
  const words = given.trim().split(/\s+/).filter(Boolean);
  if (words.length >= TITLE_WORD_MIN && words.length <= TITLE_WORD_MAX) return given.trim();
  const label = playbookTitle.split("/")[0]?.trim() || "Hidden Contract Wife";
  const padded = `${label} She Cannot Leave`.split(/\s+/).slice(0, TITLE_WORD_MAX);
  while (padded.length < TITLE_WORD_MIN) padded.push("Tonight");
  return padded.join(" ");
}

function oneLine(episode: number, playbookBeats: string[], hook?: string): string {
  const beat = playbookBeats[(episode - 1) % playbookBeats.length] ?? "The unpaid question returns";
  const act = episode <= 15 ? 1 : episode <= 30 ? 2 : episode <= 45 ? 3 : 4;
  if (hook?.trim() && episode <= 3) return `E${episode}: ${hook.trim()}`.slice(0, 140);
  if (episode === SEASON_PAYWALL_EPISODE) return `E${episode} paywall: ${beat}.`.slice(0, 140);
  return `E${episode} act${act}: ${beat}.`.slice(0, 140);
}

export function buildSeasonBible(bible: Pick<StoryBible, "title" | "logline" | "characters" | "locations" | "episode_structure"> & {
  season?: SeasonBible;
}): SeasonBible {
  if (bible.season && bible.season.episode_log.length === SEASON_EPISODE_COUNT && bible.season.loops?.length) {
    return bible.season;
  }
  const genre = inferGenre(`${bible.title} ${bible.logline}`);
  const playbook = playbookFor(genre);
  const characters = bible.characters.map((row) => row.name).slice(0, SEASON_CAST_MAX);
  for (const archetype of playbook.requiredArchetypes) {
    if (characters.length >= SEASON_CAST_MIN) break;
    const label = archetype.role.split("/")[0]?.trim();
    if (label && !characters.some((name) => name.toLowerCase() === label.toLowerCase())) characters.push(label);
  }
  const locations = (bible.locations ?? []).filter(Boolean).slice(0, SEASON_LOCATION_MAX);
  for (const piece of playbook.setPieces) {
    if (locations.length >= SEASON_LOCATION_MIN) break;
    if (!locations.includes(piece)) locations.push(piece);
  }
  const acts: SeasonAct[] = ACT_SPINES.map((spine, index) => {
    const start = index * SEASON_ACT_LENGTH + 1;
    return {
      act: (index + 1) as SeasonAct["act"],
      episodes: [start, start + SEASON_ACT_LENGTH - 1],
      spine,
    };
  });
  const guns: PlantedGun[] = [
    { name: "the dated paper", plant_ep: 1, payoff_ep: 45, note: "A named date on paper that is not hers." },
    { name: "the spare key", plant_ep: 3, payoff_ep: 52, note: "Someone else still has access." },
    { name: "the second signature", plant_ep: 6, payoff_ep: 60, note: "A name that should not be on the contract." },
  ];
  const existing = new Map((bible.episode_structure ?? []).map((row) => [row.episode_number, row]));
  const episode_log: EpisodeLogLine[] = Array.from({ length: SEASON_EPISODE_COUNT }, (_, i) => {
    const n = i + 1;
    const row = existing.get(n);
    return { episode_number: n, logline: oneLine(n, playbook.tenBeats, row?.hook ?? row?.conflict) };
  });
  return {
    title: tropeTitle(playbook.title, bible.title),
    playbook_id: playbook.id,
    core_expectation: coreExpectationFrom(bible.logline),
    acts,
    loops: [...LOOP_SPINE],
    paywall_episode: SEASON_PAYWALL_EPISODE,
    planted_guns: guns,
    characters,
    locations,
    episode_log,
  };
}

export function seasonBibleIssues(season: SeasonBible): string[] {
  const issues: string[] = [];
  const words = titleWords(season.title);
  if (words < TITLE_WORD_MIN || words > TITLE_WORD_MAX) issues.push(`title is ${words} words`);
  if (season.acts.length !== SEASON_ACTS) issues.push(`${season.acts.length} acts`);
  if (season.paywall_episode !== SEASON_PAYWALL_EPISODE) issues.push(`paywall is ${season.paywall_episode}`);
  if (!season.core_expectation?.trim()) issues.push("missing core expectation");
  if (!season.loops?.length || season.loops.length < 6) issues.push(`${season.loops?.length ?? 0} loops`);
  if (season.planted_guns.length !== PLANTED_GUN_COUNT) issues.push(`${season.planted_guns.length} planted guns`);
  if (season.characters.length < SEASON_CAST_MIN || season.characters.length > SEASON_CAST_MAX) {
    issues.push(`${season.characters.length} named characters`);
  }
  if (season.locations.length < SEASON_LOCATION_MIN || season.locations.length > SEASON_LOCATION_MAX) {
    issues.push(`${season.locations.length} locations`);
  }
  if (season.episode_log.length !== SEASON_EPISODE_COUNT) issues.push(`${season.episode_log.length} episode logs`);
  return issues;
}

export function assertSeasonBible(season: SeasonBible): SeasonBible {
  const issues = seasonBibleIssues(season);
  if (issues.length) throw new Error(`Season bible is not handbook-shaped: ${issues.join("; ")}`);
  return season;
}
