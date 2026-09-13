import { cueRows, cueText, type LooseBlocking } from "../types/continuity.ts";
import { repairCutFraming, type CutFraming } from "../types/cut.ts";
import {
  coverageDirection,
  coveragePatternFor,
  framingForRole,
  joinOpenFraming,
  listenerOf,
  type CoverageFraming,
  type CoverageRole,
} from "./coverage.ts";
import { campWhoosh, seedanceCuesOnly } from "./seedance-speech.ts";
import { placeEntrance, placeExit } from "./place.ts";

/**
 * Seedance keeps identity across 3–4 numbered shots inside one 15s generation.
 * Each shot is a different camera station. The model does the cutting.
 */

export type ShotListEntry = {
  index: number;
  role: CoverageRole;
  framing: CoverageFraming;
  on: string | null;
  cues: string[];
  seconds: number;
  direction: string;
};

const HEAT = /\?|!|name|lie|liar|know|sign|mine|yours|who|why|never|don't|stop|listen/i;

function speakerOf(row: string): string {
  return row.split(":")[0]?.trim() ?? "";
}

function parenthetical(row: string): string | null {
  const match = /\(([^)]{3,80})\)/.exec(cueText(row));
  return match?.[1]?.trim() ?? null;
}

export function spokenLine(row: string): string {
  return cueText(row).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function heatScore(row: string): number {
  const text = spokenLine(row);
  const words = text.split(/\s+/).filter(Boolean).length;
  let score = words >= 4 && words <= 12 ? 2 : 1;
  if (HEAT.test(text)) score += 2;
  if (/\?$/.test(text)) score += 1;
  if (parenthetical(row)) score += 1;
  return score;
}

function wordsOf(rows: readonly string[]): number {
  return rows.map(spokenLine).join(" ").split(/\s+/).filter(Boolean).length;
}

/** Two thoughts from one mouth, or a joined em-dash breath, must not sit as two isolated lines. */
function hasSameMouthRun(cues: readonly string[]): boolean {
  if (cues.some((row) => / — /.test(cueText(row)))) return true;
  return cues.some((row, index, all) => {
    const next = all[index + 1];
    if (!next) return false;
    const speaker = speakerOf(row);
    return Boolean(speaker && speaker === speakerOf(next) && !/\([^)]+\)/.test(cueText(next)));
  });
}

/** Spoken words only, in Seedance braces, attributed by camera side — never "NAME:". */
export function mouthLock(
  rows: readonly string[],
  listener?: string | null,
  sides?: { left?: string | null; right?: string | null },
): string {
  return seedanceCuesOnly(rows, { listener, left: sides?.left, right: sides?.right });
}

export function sceneTakeShotList(input: {
  script?: string | null;
  duration: number;
  blocking?: LooseBlocking | null;
  location?: string | null;
  takeIndex?: number | null;
  /** Last framing of the previous generation — Shot 1 must not reprint it. */
  prevLand?: CutFraming | null;
}): ShotListEntry[] {
  const rows = cueRows(input.script);
  const duration = Math.max(6, input.duration);
  const pattern = coveragePatternFor({
    takeIndex: input.takeIndex,
    coverage: input.blocking?.coverage,
  });
  const left = input.blocking?.camera_left ?? null;
  const right = input.blocking?.camera_right ?? null;
  const upper = input.blocking?.upper_frame ?? null;
  const prop = input.blocking?.prop ?? null;
  const entering = input.blocking?.enters ?? [];
  const leaving = input.blocking?.exits ?? [];

  const open = joinOpenFraming({
    takeIndex: input.takeIndex,
    coverage: input.blocking?.coverage,
    prevLand: input.prevLand,
  });
  const join = (input.takeIndex ?? 0) > 0;

  if (rows.length < 3) {
    const first = speakerOf(rows[0] ?? "") || null;
    const second = speakerOf(rows[1] ?? "") || listenerOf(first, left, right);
    const groups: Array<{ role: CoverageRole; framing: CoverageFraming; cues: string[] }> =
      rows.length <= 1
        ? [{ role: "setup", framing: join ? open : framingForRole(pattern, "setup"), cues: rows }]
        : [
            { role: "setup", framing: join ? open : "dirty", cues: [rows[0]!] },
            { role: "peak", framing: "ots", cues: rows.slice(1) },
          ];
    return stamp(groups, {
      duration,
      left,
      right,
      upper,
      prop,
      entering,
      leaving,
      location: input.location,
      second,
      join,
      prevLand: input.prevLand,
    });
  }

  let peak = 1;
  for (let i = 1; i < rows.length - 1; i += 1) {
    if (heatScore(rows[i]!) > heatScore(rows[peak]!)) peak = i;
  }
  const setup = rows.slice(0, peak);
  const cu = [rows[peak]!];
  const reactionRows = rows.slice(peak + 1, peak + 2);
  const land = rows.slice(peak + 1 + reactionRows.length);
  const peakFraming = framingForRole(pattern, "peak");
  // An insert with no named prop makes the model invent an object — a courier
  // box with printed text where the locked envelope should be.
  const station = (role: CoverageRole): CoverageFraming => {
    const framing = framingForRole(pattern, role);
    return framing === "insert" && !prop?.trim() ? "reaction" : framing;
  };
  const groups: Array<{ role: CoverageRole; framing: CoverageFraming; cues: string[] }> = [
    { role: "setup", framing: join ? open : station("setup"), cues: setup },
    { role: "peak", framing: join && peakFraming === open ? "dirty" : peakFraming, cues: cu },
  ];
  if (reactionRows.length) {
    groups.push({ role: "answer", framing: station("answer"), cues: reactionRows });
  }
  if (land.length) {
    groups.push({ role: "land", framing: station("land"), cues: land });
  }
  return stamp(groups, {
    duration,
    left,
    right,
    upper,
    prop,
    entering,
    leaving,
    location: input.location,
    join,
    prevLand: input.prevLand,
  });
}

function stamp(
  groups: Array<{ role: CoverageRole; framing: CoverageFraming; cues: string[] }>,
  input: {
    duration: number;
    left: string | null;
    right: string | null;
    upper: string | null;
    prop: string | null;
    entering: string[];
    leaving: string[];
    location?: string | null;
    second?: string | null;
    join?: boolean;
    prevLand?: CutFraming | null;
  },
): ShotListEntry[] {
  const totalWords = Math.max(1, groups.reduce((sum, group) => sum + wordsOf(group.cues), 0));
  const speakable = Math.max(3, input.duration - 1.2);
  const last = groups.length - 1;
  const repaired: Array<{ role: CoverageRole; framing: CoverageFraming; cues: string[]; on: string | null }> = [];
  for (const group of groups) {
    const speaker = speakerOf(group.cues[0] ?? "") || null;
    const prev = repaired.at(-1)
      ? { framing: repaired.at(-1)!.framing, on: repaired.at(-1)!.on }
      : input.prevLand
        ? { framing: input.prevLand, on: null }
        : null;
    const framing = repairCutFraming(prev, group.framing, speaker, input.prop);
    repaired.push({ role: group.role, framing, cues: group.cues, on: speaker });
  }
  return repaired.map((group, index) => {
    const share = wordsOf(group.cues) / totalWords;
    const seconds = Math.max(2, Math.round(share * speakable * 10) / 10);
    const speaker = group.on;
    const listener = listenerOf(speaker, input.left, input.right) ?? input.second ?? null;
    const beat = group.cues.map(parenthetical).find(Boolean) ?? null;
    const mouths = mouthLock(
      group.cues,
      group.framing === "insert" || group.framing === "master" || group.framing === "tight_two" ? null : listener,
      { left: input.left, right: input.right },
    );
    const sameBreath = hasSameMouthRun(group.cues);
    const breath = sameBreath
      ? " Same mouth keeps talking — no wait, no avatar pause. Cut closer on the second thought while they are still speaking. <swish> as we push in."
      : "";
    const entrance =
      index === 0 && input.entering.length
        ? ` ${input.entering.join(" and ")} ${placeEntrance(input.location)}.`
        : "";
    const exit =
      index === last && input.leaving.length
        ? ` On the last word ${input.leaving.join(" and ")} ${placeExit(input.location)}.`
        : "";
    const prev =
      index === 0
        ? input.prevLand
          ? { framing: input.prevLand, on: null }
          : null
        : { framing: repaired[index - 1]!.framing, on: repaired[index - 1]!.on };
    const direction = `${coverageDirection({
      framing: group.framing,
      speaker,
      listener,
      left: input.left,
      right: input.right,
      upper: input.upper,
      prop: input.prop,
      beat,
      mouths,
      first: index === 0,
      last: index === last,
      entrance,
      exit,
      join: index === 0 && input.join,
      prev,
    })}${breath}${campWhoosh(beat)}`;
    return { index: index + 1, role: group.role, framing: group.framing, on: speaker, cues: group.cues, seconds, direction };
  });
}

export function shotListPrompt(entries: readonly ShotListEntry[]): string {
  return entries
    .map((entry) => `Shot ${entry.index} (~${entry.seconds}s): ${entry.direction}`)
    .join(" | ");
}

/** Last framing of a run of takes, chained so join cuts stay legal. */
export function lastFramingOf(
  takes: ReadonlyArray<{
    script?: string | null;
    duration?: number | null;
    blocking?: LooseBlocking | null;
  }>,
): CutFraming | null {
  let prevLand: CutFraming | null = null;
  for (const [index, take] of takes.entries()) {
    const list = sceneTakeShotList({
      script: take.script,
      duration: take.duration ?? 15,
      blocking: take.blocking,
      takeIndex: index,
      prevLand,
    });
    prevLand = list.at(-1)?.framing ?? prevLand;
  }
  return prevLand;
}
