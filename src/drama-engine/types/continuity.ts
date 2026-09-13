import { placeEntrance, placeExit, placeKind, placeNoun } from "../craft/place.ts";
import { inferPropLock, lockDoorSide, type ScreenSide } from "./physics.ts";

export type { ScreenSide };

/** Blocking that must stay true for every take in the same room. */

export type SceneCoverage = "two_shot" | "room" | "single" | "cu";

export type SceneBlocking = {
  camera_left: string | null;
  camera_right: string | null;
  prop: string;
  left_gesture: string;
  right_gesture: string;
  start_from?: string | null;
  coverage?: SceneCoverage;
  pictured?: string | null;
  /** Everyone in the room this take, speaking or not. Carries over until a scripted exit. */
  present?: string[];
  /** Who walks in during this take (their first take in the room). */
  enters?: string[];
  /** Who walks out at the end of this take (a "(leaves)" parenthetical on their cue). */
  exits?: string[];
  /** Vertical opposition: who holds the upper frame (standing, camera a touch below their eye line). */
  upper_frame?: string | null;
  /**
   * Where every body is and in what posture, written by the planner from the
   * script ("COLE half-sits against the wet brick wall on the ground; MARA kneels
   * over him"). This is the physics of the take; the prompt repeats it verbatim.
   */
  staging?: string | null;
  /** The physical thing the staging is anchored to ("the brick wall and the puddle line", "the steel counter"). */
  anchor?: string | null;
  /** Locked screen side of the door for this room. Does not jump between takes. */
  door_side?: ScreenSide | null;
};

/** Default power holder: the second lead to speak in the episode (the Wall), unless the plan says otherwise. */
export function upperFrameFor(names: readonly string[], locked?: string | null): string | null {
  if (locked) return locked;
  return names[1] ?? names[0] ?? null;
}

const EXIT_BEAT = /\b(leaves|leave|exits|exit|walks out|goes out|out the door|storms out|steps out)\b/i;

export function exitsIn(script?: string | null): string[] {
  const out: string[] = [];
  for (const row of cueRows(script)) {
    const name = row.split(":")[0]?.trim();
    const beat = /\(([^)]*)\)/.exec(cueText(row))?.[1] ?? "";
    if (name && EXIT_BEAT.test(beat) && !out.some((row) => sameFirst(row, name))) out.push(name);
  }
  return out;
}

function sameFirst(a: string, b: string): boolean {
  return a.trim().toLowerCase().split(/\s+/)[0] === b.trim().toLowerCase().split(/\s+/)[0];
}

/**
 * Who is in the room for each take. People stay once they have spoken until
 * a cue of theirs carries an exit beat; a new speaker is an entrance. This is
 * what stops a character swapping places with someone who was never seen
 * leaving.
 */
export function presenceLedger(
  takes: ReadonlyArray<{ speakers: readonly string[]; script?: string | null; sameRoomAsPrevious: boolean }>,
  maxPresent = 3,
): Array<{ present: string[]; enters: string[]; exits: string[] }> {
  const out: Array<{ present: string[]; enters: string[]; exits: string[] }> = [];
  let carried: string[] = [];
  for (const take of takes) {
    const base = take.sameRoomAsPrevious ? carried : [];
    const enters = take.sameRoomAsPrevious ? take.speakers.filter((name) => !base.some((row) => sameFirst(row, name))) : [];
    const present = [...base];
    for (const name of take.speakers) if (!present.some((row) => sameFirst(row, name))) present.push(name);
    const trimmed = present.slice(0, maxPresent);
    const exits = exitsIn(take.script).filter((name) => trimmed.some((row) => sameFirst(row, name)));
    out.push({ present: trimmed, enters, exits });
    carried = trimmed.filter((name) => !exits.some((row) => sameFirst(row, name)));
  }
  return out;
}

export const SCENE_SPEECH = {
  words_per_sec: 2.8,
  settle_s: 0.6,
  cue_gap_s: 0.25,
} as const;

const CUE = /^([A-Za-z][A-Za-z0-9' .-]{0,40}):\s*(.+)$/;

export function cueRows(script?: string | null): string[] {
  return (script ?? "")
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => {
      const match = CUE.exec(row);
      return Boolean(match?.[2]?.trim());
    });
}

export function cueText(row: string): string {
  return row.replace(/^[A-Za-z][A-Za-z0-9' .-]{0,40}:\s*/, "").trim();
}

export function spokenSeconds(rows: readonly string[]): number {
  const words = rows
    .map((row) => cueText(row).replace(/\([^)]*\)/g, " "))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return SCENE_SPEECH.settle_s + words / SCENE_SPEECH.words_per_sec + Math.max(0, rows.length - 1) * SCENE_SPEECH.cue_gap_s;
}

export function fitCueRows(rows: readonly string[], maxSeconds: number): { keep: string[]; overflow: string[] } {
  const keep: string[] = [];
  const overflow: string[] = [];
  for (const row of rows) {
    if (!keep.length || spokenSeconds([...keep, row]) <= maxSeconds + 1e-9) keep.push(row);
    else overflow.push(row);
  }
  if (keep.length === 1 && spokenSeconds(keep) > maxSeconds) {
    const words = cueText(keep[0]!).split(/\s+/).filter(Boolean);
    const name = keep[0]!.split(":")[0] ?? "SPEAKER";
    const budget = Math.max(4, Math.floor((maxSeconds - SCENE_SPEECH.settle_s) * SCENE_SPEECH.words_per_sec));
    keep[0] = `${name}: ${words.slice(0, budget).join(" ")}`;
  }
  return { keep, overflow };
}

/**
 * One sentence per cue. A two-sentence cue becomes two consecutive cues of the
 * same speaker; the parenthetical beat stays on the first. Dashes and
 * ellipses inside a sentence are not splits.
 */
export function splitCueSentences(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const name = row.split(":")[0]?.trim();
    const text = cueText(row);
    if (!name || !text) continue;
    const beat = /^\(([^)]*)\)\s*/.exec(text);
    const spoken = beat ? text.slice(beat[0].length) : text;
    const sentences = spoken
      .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (sentences.length <= 1) {
      out.push(row);
      continue;
    }
    sentences.forEach((sentence, index) => {
      out.push(`${name}: ${index === 0 && beat ? `${beat[0].trim()} ` : ""}${sentence}`);
    });
  }
  return out;
}

export function cueWordCount(row: string): number {
  return cueText(row)
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function packCuesIntoWindows(rows: readonly string[], takeCount: number, maxSeconds: number): string[][] {
  const n = Math.max(1, takeCount);
  const groups: string[][] = Array.from({ length: n }, () => []);
  let index = 0;
  for (const row of rows) {
    const current = groups[index]!;
    const would = spokenSeconds([...current, row]);
    if (current.length && would > maxSeconds && index < n - 1) {
      index += 1;
      groups[index]!.push(row);
      continue;
    }
    if (current.length && would > maxSeconds && index === n - 1) continue;
    current.push(row);
  }
  return groups.filter((group) => group.length > 0);
}

export { inferPropLock } from "./physics.ts";

/** Plan/shot blocking as stored: every field optional and nullable. */
export type LooseBlocking = { [K in keyof SceneBlocking]?: SceneBlocking[K] | null };

export function assignSceneSides(
  names: readonly string[],
  locked?: Pick<LooseBlocking, "camera_left" | "camera_right"> | null,
): { camera_left: string | null; camera_right: string | null } {
  if (locked?.camera_left || locked?.camera_right) {
    return { camera_left: locked.camera_left ?? names[0] ?? null, camera_right: locked.camera_right ?? names[1] ?? null };
  }
  return { camera_left: names[0] ?? null, camera_right: names[1] ?? null };
}

export function blockingPrompt(block: SceneBlocking, location?: string | null): string {
  const left = block.camera_left ?? "the person on camera-left";
  const right = block.camera_right ?? "the person on camera-right";
  const third = (block.present ?? []).find((name) => !sameFirst(name, left) && !sameFirst(name, right));
  const entering = block.enters ?? [];
  const leaving = block.exits ?? [];
  const anchor = block.anchor?.trim() || "the anchor furniture";
  const noun = placeNoun(location);
  return [
    "SCREEN DIRECTION LOCK for this whole location.",
    `${left} stays camera-left. ${right} stays camera-right. They do not swap sides.`,
    block.staging?.trim()
      ? `STAGING, locked for the whole take: ${block.staging.trim().replace(/[.]+$/, "")}. Every shot shows these exact positions and postures. Nobody stands up, sits down, or moves unless a cue says so.`
      : null,
    `${left} ${block.left_gesture}.`,
    `${right} ${block.right_gesture}.`,
    third
      ? `${third} is the third person in the ${noun}: one step back, between them in depth, never in either lead's position.`
      : null,
    entering.length
      ? placeKind(location) === "outdoor"
        ? `ENTRANCE PHYSICS. ${entering.join(" and ")} ${entering.length > 1 ? "were" : "was"} not in the ${noun} before. ${entering.join(" and ")} ${placeEntrance(location)} during Shot 1 and stays there. Nobody else moves.`
        : `ENTRANCE PHYSICS. ${entering.join(" and ")} ${entering.length > 1 ? "are" : "is"} NOT in the ${noun} at frame 0. The locked door stays ${block.door_side ?? "camera-right"}. Shot 1 is a full-page of ${entering.join(" and ")} coming through THAT door. Only after they cross the threshold do they stand one step back. They cannot already be inside.`
      : `Nobody enters. The ${noun} holds the same people it had.`,
    leaving.length
      ? `EXIT: at the end of the last shot ${leaving.join(" and ")} ${placeExit(location)}`
      : null,
    block.upper_frame
      ? `VERTICAL OPPOSITION: ${block.upper_frame} holds the upper frame — head higher in frame, camera a touch below their eye line. ${
          [left, right].find((name) => !sameFirst(name, block.upper_frame!)) ?? "The other"
        } is lower in frame, camera a touch above their eye line. Power reads top to bottom in one frame, using the postures in STAGING.`
      : null,
    `PROP LOCK: ${block.prop}. Same object identity. If the line says it is broken or open, show that state still — never the sealed still.`,
    `SET LOCK. Same ${noun} plate. ${anchor} keeps its size and place. Same walls, same ground, same key light. Nobody leaves ${anchor}. ROOM LOCK. The door stays ${block.door_side ?? "camera-right"}. It does not jump sides.`,
    block.start_from
      ? `Start this take from that exact end state: ${block.start_from}`
      : "Start with everyone already in their staged positions, not arriving.",
  ]
    .filter(Boolean)
    .join(" ");
}

const COVERAGE_ROTATION: SceneCoverage[] = ["two_shot", "single", "room", "cu"];

export function coverageForTake(
  index: number,
  _total?: number,
  names?: readonly string[],
  _emotion?: string | null,
): { coverage: SceneCoverage; pictured: string | null } {
  const coverage = COVERAGE_ROTATION[Math.max(0, index) % COVERAGE_ROTATION.length]!;
  const pictured = coverage === "single" || coverage === "cu" ? names?.[index % (names.length || 1)] ?? names?.[0] ?? null : null;
  return { coverage, pictured };
}

export function coverageCamera(block: SceneBlocking, people: readonly string[], takeIndex = 0): string {
  const left = block.camera_left ?? people[0] ?? "one person";
  const right = block.camera_right ?? people[1] ?? "the other";
  const pictured = block.pictured ?? left;
  const other = [left, right].find((name) => name !== pictured) ?? right;
  const prop = block.prop;
  const anchor = block.anchor?.trim() || "the locked anchor";
  if (takeIndex > 0) {
    return takeIndex % 2 === 1
      ? `JOIN CUT. Chest-up MCU on ${pictured} only, head and a portion of the chest, key light on the face. Do not reprint the previous take's last frame. ${prop}. Do not stack two faces, never the lens — Shot 1 only`
      : `JOIN CUT. Cowboy or chest-up of ${pictured} at ${anchor}. One relevant person. Do not reprint the previous take's last frame. ${prop}. Do not stack two faces, never the lens — Shot 1 only`;
  }
  if (block.coverage === "cu") {
    return `close-up on ${pictured} only for heat, chin to collar, key light in the eyes, ${other} out of the tight frame at ${anchor}, ${prop}, do not stack two faces, never the lens — Shot 1 only`;
  }
  if (block.coverage === "single") {
    return `over-the-shoulder from behind ${other}, ${pictured} is the face, ${other} is a shoulder in the foreground, ${anchor} as staged, ${prop}, never the lens — Shot 1 only`;
  }
  if (block.coverage === "room") {
    return `wider 3/4 two-shot of the locked place, ${left} camera-left and ${right} camera-right at ${anchor}, show the ground and walls, ${prop}, never a flat side-profile, never the lens — Shot 1 only`;
  }
  return `3/4 two-shot closer to ${left}, ${left} camera-left and ${right} camera-right at ${anchor}, mid-thigh up, ${prop}, NOT a flat side-profile, never the lens — Shot 1 only, later shots must change camera`;
}

export function sceneBlockingOf(input: {
  names?: readonly string[];
  camera?: string | null;
  scene_script?: string | null;
  blocking?: LooseBlocking | null;
}): SceneBlocking {
  const sides = assignSceneSides(input.names ?? [], input.blocking);
  return {
    camera_left: sides.camera_left,
    camera_right: sides.camera_right,
    prop: input.blocking?.prop ?? inferPropLock(`${input.camera ?? ""}\n${input.scene_script ?? ""}`),
    left_gesture: input.blocking?.left_gesture ?? "holds the position and posture written in STAGING, hands visible, does not walk",
    right_gesture: input.blocking?.right_gesture ?? "holds the position and posture written in STAGING, hands visible, does not walk",
    start_from: input.blocking?.start_from ?? null,
    coverage: input.blocking?.coverage ?? undefined,
    pictured: input.blocking?.pictured ?? null,
    present: input.blocking?.present ?? undefined,
    enters: input.blocking?.enters ?? undefined,
    exits: input.blocking?.exits ?? undefined,
    upper_frame: input.blocking?.upper_frame ?? null,
    staging: input.blocking?.staging ?? null,
    anchor: input.blocking?.anchor ?? null,
    door_side: input.blocking?.door_side ?? lockDoorSide([input.blocking?.staging, input.camera, input.scene_script]),
  };
}

/** Everyone the take must picture: speakers plus anyone already in the room. A line can never drop a person. */
export function peopleInTake(input: {
  speakers: readonly string[];
  blocking?: LooseBlocking | null;
}): string[] {
  const raw: string[] = [];
  const push = (name?: string | null) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (!raw.some((row) => sameFirst(row, trimmed))) raw.push(trimmed);
  };
  for (const name of input.speakers) push(name);
  for (const name of input.blocking?.present ?? []) push(name);
  return orderByCameraSides(raw.slice(0, 3), input.blocking);
}

/** Face refs pack left then right so @Image1 is the person on camera-left. */
function orderByCameraSides(
  names: readonly string[],
  blocking?: Pick<LooseBlocking, "camera_left" | "camera_right"> | null,
): string[] {
  const left = blocking?.camera_left;
  const right = blocking?.camera_right;
  if (!left && !right) return [...names];
  const ordered: string[] = [];
  const take = (wanted?: string | null) => {
    if (!wanted) return;
    const hit = names.find((row) => sameFirst(row, wanted));
    if (hit && !ordered.some((row) => sameFirst(row, hit))) ordered.push(hit);
  };
  take(left);
  take(right);
  for (const name of names) take(name);
  return ordered;
}

export function stampCameraSides(camera: string, block: SceneBlocking): string {
  if (/camera-left|camera-right/i.test(camera)) return camera;
  const left = block.camera_left;
  const right = block.camera_right;
  if (!left && !right) return camera;
  return `${camera.replace(/\.+$/, "")}. ${left ?? "one person"} stays camera-left, ${right ?? "the other"} stays camera-right, ${block.prop}`;
}
