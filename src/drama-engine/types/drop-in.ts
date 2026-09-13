import { cueRows, cueText, peopleInTake, type LooseBlocking } from "./continuity.ts";

/**
 * Genre-agnostic short-drama law: a TikTok ad can open on any episode and
 * the viewer still understands the scene. Writer, polish, and the skill
 * share this clause so it cannot drift.
 */
export const DROP_IN_RULES = `DROP-IN. A viewer who opened a TikTok ad on THIS episode understands the whole scene with no previous episode. True for episode 1 and episode 47.
- Take 1, through conflict not lecture: who these two people are to each other (role/relationship), what object or decision is on the table, and what it costs if they walk away. Two people on camera — a fight you can see. One face talking to a ghost fails.
- A new body on camera gets a role in the same take ("my second", "the night nurse", "your sister"). Never a proper name the viewer has not met.
- Imply the mechanism in human talk. Do not lecture lore nouns or introduce a mystery person.
- Last take puts them inside the storyline and raises the next need. They leave wanting more, not confused.
- Loop openers stay stricter: both leads appear and speak in take 1. Drop-in applies to every episode.`;

/**
 * Role nouns a drop-in viewer can place without prior episodes.
 * Optional short adjectives are allowed so "the night nurse" matches.
 * Vocative "Boss." alone does not identify the person who just entered.
 */
export const DROP_IN_ROLE_NOUN =
  "sister|brother|mother|father|mom|dad|wife|husband|cousin|ex[- ]wife|boss|assistant|driver|secretary|second|nurse|intern|patient|doctor|lawyer|client|partner|manager|aide|guard|receptionist|surgeon|resident";

export const DROP_IN_WHO_PHRASE = "the (?:woman|man|one) (?:in the doorway|who\\b|that\\b)|the one who";

const ENTERS_BEAT = /\b(enters|enter|walks in|comes in|steps in)\b/i;

export type DropInTake = {
  script?: string | null;
  speaker?: string | null;
  speakerOnCamera?: string | null;
  blocking?: LooseBlocking | null;
};

export type DropInHit = {
  kind: "solo_opener" | "entrance_unnamed";
  detail: string;
};

export type EntranceNameHit = { name: string; line: string };

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function foldName(name: string): string {
  return firstNameOf(name).toLowerCase();
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spokenFromCue(row: string): string {
  return cueText(row).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

export function rolePhraseSource(): string {
  return `(?:my|your|his|her|our|the)\\s+(?:[a-z]{3,}\\s+){0,2}(?:${DROP_IN_ROLE_NOUN})`;
}

/** True when spoken text names a role a cold viewer can place. */
export function spokenHasRoleId(spoken: string): boolean {
  const text = spoken.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return new RegExp(`(?:${rolePhraseSource()})|(?:${DROP_IN_WHO_PHRASE})`, "i").test(text);
}

export function speakersOnDropInTake(take: DropInTake): string[] {
  const names: string[] = [];
  const push = (name?: string | null) => {
    const token = name?.trim();
    if (!token) return;
    if (!names.some((row) => foldName(row) === foldName(token))) names.push(token);
  };
  for (const row of cueRows(take.script)) push(row.split(":")[0]);
  push(take.speaker);
  push(take.speakerOnCamera);
  return names;
}

export function peopleOnDropInTake(take: DropInTake): string[] {
  return peopleInTake({ speakers: speakersOnDropInTake(take), blocking: take.blocking });
}

function scriptedEntrants(script?: string | null): string[] {
  const out: string[] = [];
  for (const row of cueRows(script)) {
    const name = row.split(":")[0]?.trim();
    const beat = /\(([^)]*)\)/.exec(cueText(row))?.[1] ?? "";
    if (name && ENTERS_BEAT.test(beat) && !out.some((row) => foldName(row) === foldName(name))) {
      out.push(firstNameOf(name));
    }
  }
  return out;
}

/**
 * Conservative entrance set: blocking.enters, an (enters) parenthetical,
 * and — after take 1 — a new speaker who was not already present.
 * Take 1 faces are the opening fight, not unlabeled entrances, unless
 * the script or blocking marks them as walking in.
 */
export function entrantsOnDropInTake(take: DropInTake, previousPresent: readonly string[]): string[] {
  const out: string[] = [];
  const push = (name?: string | null) => {
    const token = firstNameOf(name ?? "");
    if (!token) return;
    if (!out.some((row) => foldName(row) === foldName(token))) out.push(token);
  };
  for (const name of take.blocking?.enters ?? []) push(name);
  for (const name of scriptedEntrants(take.script)) push(name);
  if (previousPresent.length) {
    for (const name of speakersOnDropInTake(take)) {
      if (!previousPresent.some((row) => foldName(row) === foldName(name))) push(name);
    }
  }
  return out;
}

/**
 * Heuristic: fail only when an entrant is spoken as a proper name and the
 * take never IDs them by role. "My second" / "the night nurse" / "your sister"
 * in the same take passes even if the name is also said. A new speaker who
 * is never named is left to UNSEEN_NAME / intro labels — too brittle to block.
 */
export function unlabeledEntranceHits(input: {
  take: DropInTake;
  previousPresent?: readonly string[];
}): EntranceNameHit[] {
  const previous = input.previousPresent ?? [];
  const entrants = entrantsOnDropInTake(input.take, previous);
  if (!entrants.length) return [];
  const spoken = cueRows(input.take.script).map(spokenFromCue).filter(Boolean).join(" ");
  if (spokenHasRoleId(spoken)) return [];
  const hits: EntranceNameHit[] = [];
  const seen = new Set<string>();
  for (const row of cueRows(input.take.script)) {
    const line = spokenFromCue(row);
    if (!line) continue;
    for (const name of entrants) {
      const token = foldName(name);
      if (!token || seen.has(token)) continue;
      if (!new RegExp(`\\b${escapeName(name)}\\b`, "i").test(line)) continue;
      seen.add(token);
      hits.push({ name: firstNameOf(name), line });
    }
  }
  return hits;
}

/** Comprehension / re-anchor gate. UNSEEN_NAME stays the off-camera name gate. */
export function dropInProblems(input: { takes: readonly DropInTake[] }): DropInHit[] {
  const hits: DropInHit[] = [];
  const first = input.takes[0];
  if (first) {
    const people = peopleOnDropInTake(first);
    if (people.length < 2) {
      hits.push({
        kind: "solo_opener",
        detail: `${people[0] ?? "one face"} talking with nobody on camera`,
      });
    }
  }
  let present: string[] = [];
  for (let index = 0; index < input.takes.length; index += 1) {
    const take = input.takes[index]!;
    const unnamed = unlabeledEntranceHits({
      take,
      previousPresent: index === 0 ? [] : present,
    });
    for (const hit of unnamed) {
      hits.push({ kind: "entrance_unnamed", detail: `${hit.name} enters without a role ("${hit.line}")` });
    }
    const onCamera = peopleOnDropInTake(take);
    if (onCamera.length) present = onCamera;
  }
  return hits;
}
