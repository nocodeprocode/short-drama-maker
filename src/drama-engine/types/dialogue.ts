import { cueRows, cueText } from "./continuity.ts";
import { DROP_IN_WHO_PHRASE, rolePhraseSource } from "./drop-in.ts";

export type DialogueLine = {
  speaker: string;
  text: string;
  maxWords: 12;
  triggersNext: true;
  interruptible: boolean;
  concreteObject?: string;
  survivesCaption: true;
};

export const DIALOGUE_MAX_WORDS = 12;

export function wordCount(text: string | null | undefined): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** One breath, one caption. Keep the speaker tag and a parenthetical; clip the spoken words. */
function speakerOf(row: string): string {
  return row.split(":")[0]?.trim() ?? "";
}

/**
 * Two short lines from the same mouth, no stunned beat, become one breath.
 * Stops the avatar pause: "I opened it." / wait / "It was cracked."
 */
export function collapseSameSpeakerBreaths(rows: readonly string[], maxWords = DIALOGUE_MAX_WORDS): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const prev = out.at(-1);
    if (!prev) {
      out.push(row);
      continue;
    }
    const speaker = speakerOf(row);
    if (!speaker || speaker.toLowerCase() !== speakerOf(prev).toLowerCase()) {
      out.push(row);
      continue;
    }
    const nextSpoken = cueText(row);
    if (/\([^)]+\)/.test(nextSpoken)) {
      out.push(row);
      continue;
    }
    const joined = `${cueText(prev).replace(/[.?!]+$/, "")} — ${nextSpoken.replace(/^\s*[—–-]\s*/, "")}`;
    if (wordCount(joined.replace(/\([^)]*\)/g, " ")) > maxWords) {
      out.push(row);
      continue;
    }
    out[out.length - 1] = `${speaker}: ${joined}`;
  }
  return out;
}

export function clipCueToBreath(row: string, maxWords = DIALOGUE_MAX_WORDS): string {
  const limit = Number.isFinite(maxWords) && maxWords >= 1 ? maxWords : DIALOGUE_MAX_WORDS;
  const match = row.match(/^([A-Za-z][A-Za-z0-9' .-]{0,40}:\s*)([\s\S]*)$/);
  const prefix = match?.[1] ?? "";
  const rest = (match?.[2] ?? row).trim();
  const paren = rest.match(/^(\([^)]*\)\s*)/);
  const stage = paren?.[1] ?? "";
  const spoken = rest.slice(stage.length).replace(/\s+/g, " ").trim();
  const words = spoken.split(/\s+/).filter(Boolean);
  if (!words.length || words.length <= limit) return row;
  return `${prefix}${stage}${words.slice(0, limit).join(" ")}`.trim();
}

export function lineSurvivesCaption(text: string | null | undefined): boolean {
  const words = wordCount(text);
  return words >= 1 && words <= DIALOGUE_MAX_WORDS;
}

export function dialogueKey(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dialogueTooClose(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = dialogueKey(a);
  const right = dialogueKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(" ").filter((word) => word.length > 2));
  const rightTokens = right.split(" ").filter((word) => word.length > 2);
  if (leftTokens.size === 0 || rightTokens.length === 0) return false;
  const overlap = rightTokens.filter((word) => leftTokens.has(word)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.length) >= 0.7;
}

/** Spoken words from a "NAME: line" scene script, without cue names or stage business. */
export function spokenTextFromSceneScript(sceneScript: string): string {
  return sceneScript
    .split(/\n+/)
    .map((line) => line.replace(/^[A-Za-z][A-Za-z0-9 .'-]{0,24}:\s*/, "").replace(/\[[^\]]*\]/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function spokenTextFromTake(input: { scene_script?: string | null; dialogue?: string | null }): string {
  const script = (typeof input.scene_script === "string" ? input.scene_script.trim() : "");
  if (script) return spokenTextFromSceneScript(script);
  return input.dialogue?.trim() ?? "";
}

function firstSpokenLine(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
}

/** True when two scene takes would make Seedance say the same beat twice. */
export function sceneTakesShareSpokenBeat(
  a: { scene_script?: string | null; dialogue?: string | null },
  b: { scene_script?: string | null; dialogue?: string | null },
): boolean {
  const left = spokenTextFromTake(a);
  const right = spokenTextFromTake(b);
  if (!left || !right) return false;
  if (dialogueTooClose(left, right)) return true;
  // A conversation holds a subject across takes (the fever, the name). That is
  // continuity, not a repeat. A repeated beat is the same words said again, so
  // the comparison is cue by cue: one echoed line is a handoff, two is a replay.
  const cuesOf = (input: { scene_script?: string | null; dialogue?: string | null }) =>
    (typeof input.scene_script === "string" && input.scene_script.trim() ? input.scene_script : input.dialogue ?? "")
      .split(/\n+/)
      .map((row) => row.replace(/^[A-Za-z][A-Za-z0-9 .'-]{0,24}:\s*/, "").trim())
      .filter(Boolean);
  const leftLines = cuesOf(a);
  const rightLines = cuesOf(b);
  const smallest = Math.min(leftLines.length, rightLines.length);
  if (!smallest) return false;
  const shared = leftLines.filter((row) => rightLines.some((other) => dialogueTooClose(row, other)));
  // Two people circling the same fact will restate a line or two; that is the
  // conversation. A replay is when half the shorter take is already spoken.
  return shared.length >= 2 && shared.length / smallest >= 0.5;
}

/** Same spoken text, or one take is the other take restated in full. */
export function sceneTakesAreCopies(
  a: { scene_script?: string | null; dialogue?: string | null },
  b: { scene_script?: string | null; dialogue?: string | null },
): boolean {
  const left = dialogueKey(spokenTextFromTake(a));
  const right = dialogueKey(spokenTextFromTake(b));
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

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

/** Same-breath ID: "your sister Juno", "Juno, my sister", "the woman in the doorway". */
export function identifiesNameInBreath(spoken: string, name: string): boolean {
  const token = firstNameOf(name);
  if (!token) return false;
  const n = escapeName(token);
  const role = rolePhraseSource();
  return new RegExp(
    `(?:\\b${n}\\b[,:—–-]?\\s+${role})|(?:${role}\\s+${n}\\b)|(?:\\b${n}\\b[,:—–-]?\\s+(?:${DROP_IN_WHO_PHRASE}))|(?:(?:${DROP_IN_WHO_PHRASE})\\s*,?\\s*${n}\\b)`,
    "i",
  ).test(spoken);
}

export type UnseenNameHit = { name: string; line: string };

/**
 * A proper name in spoken dialogue that the viewer has not met on camera
 * this episode, is not present on this take, and is not identified in the
 * same breath. "Juno still gets her surgery?" fails; "your sister" does not.
 */
export function unseenNamesInScript(input: {
  script?: string | null;
  onCamera?: readonly string[];
  metThisEpisode?: readonly string[];
  namedCast?: readonly string[];
}): UnseenNameHit[] {
  const known = new Set<string>();
  for (const name of input.onCamera ?? []) {
    const token = foldName(name);
    if (token) known.add(token);
  }
  for (const name of input.metThisEpisode ?? []) {
    const token = foldName(name);
    if (token) known.add(token);
  }
  const roster = [...new Set((input.namedCast ?? []).map(firstNameOf).filter((name) => name.length >= 2))];
  if (!roster.length) return [];
  const hits: UnseenNameHit[] = [];
  const seenHit = new Set<string>();
  for (const row of cueRows(input.script)) {
    const speaker = foldName(row.split(":")[0] ?? "");
    if (speaker) known.add(speaker);
    const spoken = spokenFromCue(row);
    if (!spoken) continue;
    for (const name of roster) {
      const token = foldName(name);
      if (!token || known.has(token)) continue;
      if (!new RegExp(`\\b${escapeName(name)}\\b`, "i").test(spoken)) continue;
      if (identifiesNameInBreath(spoken, name)) continue;
      const key = `${token}:${spoken.toLowerCase()}`;
      if (seenHit.has(key)) continue;
      seenHit.add(key);
      hits.push({ name: firstNameOf(name), line: spoken });
    }
  }
  return hits;
}

/** Swap an unseen proper name for a role phrase when the bible gives one. */
export function rewriteUnseenNames(
  script: string,
  hits: readonly UnseenNameHit[],
  standInFor: (name: string, speaker: string) => string | null,
): string {
  if (!hits.length) return script;
  return cueRows(script)
    .map((row) => {
      const speaker = (row.split(":")[0] ?? "").trim();
      const prefix = row.match(/^([A-Za-z][A-Za-z0-9' .-]{0,40}:\s*)/)?.[1] ?? "";
      let rest = row.slice(prefix.length);
      for (const hit of hits) {
        const standIn = standInFor(hit.name, speaker);
        if (!standIn) continue;
        rest = rest.replace(new RegExp(`\\b${escapeName(hit.name)}\\b`, "gi"), standIn);
      }
      return `${prefix}${rest}`;
    })
    .join("\n");
}

/**
 * Drop take N's first cue when it restates take N-1's last spoken line.
 * Keep at least 3 cues if possible; never empty the take.
 */
export function dropOpeningEcho(
  previousScript: string | null | undefined,
  currentScript: string | null | undefined,
): string {
  const original = currentScript ?? "";
  const previous = cueRows(previousScript);
  const current = cueRows(currentScript);
  if (!previous.length || !current.length) return original;
  if (!dialogueTooClose(cueText(previous[previous.length - 1]!), cueText(current[0]!))) return original;
  const rest = current.slice(1);
  if (!rest.length) return original;
  return rest.join("\n");
}

/** Walk consecutive scene takes and strip a seam echo from each opener. */
export function stripEchoCues<T extends { scene_script?: string | null; dialogue?: string | null }>(takes: T[]): T[] {
  const out = takes.map((take) => ({ ...take }));
  for (let i = 1; i < out.length; i += 1) {
    const next = dropOpeningEcho(out[i - 1]!.scene_script, out[i]!.scene_script);
    if (next === (out[i]!.scene_script ?? "")) continue;
    const first = cueRows(next)[0];
    out[i] = {
      ...out[i]!,
      scene_script: next,
      dialogue: first ? cueText(first) : out[i]!.dialogue,
    };
  }
  return out;
}
