import { cueRows, cueText } from "../types/continuity.ts";

/**
 * Seedance 2.5 official audio syntax (ByteDance / fal guide):
 *   {spoken line}   dialogue — the only words that leave a mouth
 *   (music bed)     music
 *   <whoosh>        sound effect
 *
 * Dumping "MARA: Don't." makes the model speak the label: "Mara says don't."
 * Attribute by camera side. Put the line in braces. Ban speaking names.
 */

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function sameFirst(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = firstName(a).toLowerCase();
  const right = firstName(b).toLowerCase();
  return Boolean(left && right && left === right);
}

function speakerOf(row: string): string {
  return row.split(":")[0]?.trim() ?? "";
}

export function cameraWho(
  name: string | null,
  left?: string | null,
  right?: string | null,
): string {
  if (name && left && sameFirst(name, left)) return "the person on camera-left";
  if (name && right && sameFirst(name, right)) return "the person on camera-right";
  if (name && left && right) return "the third person";
  return "the person on camera";
}

export const SEEDANCE_SPEECH_RULES =
  "Dialogue language: conversational American English. " +
  "Speak only the text inside {braces}. " +
  "Never speak a character name unless it is inside the braces. Never speak the word says. Never read the prompt. Never read a label.";

export const SHORT_DRAMA_SCORE =
  "(low cheap short-drama pulse under the talk, not an orchestra, not a Hollywood swell)";

export function seedanceCue(row: string, left?: string | null, right?: string | null): string | null {
  const name = speakerOf(row);
  const line = spokenLinePlain(row);
  if (!line) return null;
  return `${cameraWho(name, left, right)}: {${line}}`;
}

/** Consecutive lines from one mouth become one brace so Seedance does not wait. */
export function speechBreaths(rows: readonly string[]): Array<{ name: string; line: string }> {
  const out: Array<{ name: string; line: string }> = [];
  for (const row of rows) {
    const name = speakerOf(row);
    const line = spokenLinePlain(row);
    if (!line) continue;
    const prev = out.at(-1);
    if (prev && prev.name.toLowerCase() === name.toLowerCase() && !/\([^)]+\)/.test(cueText(row))) {
      prev.line = `${prev.line.replace(/[.?!]+$/, "")} — ${line}`;
      continue;
    }
    out.push({ name, line });
  }
  return out;
}

export function seedanceCuesOnly(
  rows: readonly string[],
  input?: { listener?: string | null; left?: string | null; right?: string | null },
): string {
  const parts = speechBreaths(rows).map((row) => `${cameraWho(row.name, input?.left, input?.right)}: {${row.line}}`);
  if (!parts.length) return "Nobody speaks. Mouths closed.";
  const still = input?.listener?.trim()
    ? ` ${cameraWho(input.listener, input.left, input.right)} stays silent, mouth closed.`
    : "";
  return `${parts.join(" ")}${still}`;
}

export function seedanceSpeech(
  rows: readonly string[],
  input?: { listener?: string | null; left?: string | null; right?: string | null },
): string {
  return `${SEEDANCE_SPEECH_RULES} ${seedanceCuesOnly(rows, input)}`;
}

export function seedanceSpeechBlock(
  script: string,
  sides?: { camera_left?: string | null; camera_right?: string | null } | null,
): string {
  const rows = cueRows(script);
  const spoken = seedanceSpeech(rows, { left: sides?.camera_left, right: sides?.camera_right });
  return (
    `SPEECH. Native speech. SAME BREATH. One person, two thoughts = one {brace}, no wait, no avatar pause. ` +
    `Cut closer on the second thought while they are still talking. The only legal pause is a parenthetical stunned face. ` +
    `${spoken} ` +
    `Parentheticals are face acting, not words. ` +
    `If a line is not inside braces, do not say it.`
  );
}

export function campWhoosh(beat?: string | null): string {
  if (!beat) return "";
  if (!/\b(laugh|smirk|snort|whoop|can't help|almost smiles|bites a laugh)\b/i.test(beat)) return "";
  return " <short comic whoosh> One funny face, under a second, then back to the fight.";
}

export function spokenLinePlain(row: string): string {
  return cueText(row).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}
