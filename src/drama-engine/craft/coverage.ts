import { cameraWho } from "./seedance-speech.ts";
import { shortPropLabel } from "../types/physics.ts";
import {
  CUT_RULES,
  cutMoveLine,
  cutMoveOf,
  cutSound,
  joinOpenSize,
  type CutFraming,
  type CutShot,
} from "../types/cut.ts";

/**
 * Dialogue coverage. A scene is not one camera.
 *
 * Every numbered shot is a different size or a different person. AI lighting
 * never matches a reprint — if the cut stays MCU on the same face, the lamp
 * jumps. Size goes cowboy → MCU → CU, or we reverse, or we smash to the prop.
 */

export type CoverageFraming = CutFraming;
export type CoverageRole = "setup" | "peak" | "answer" | "land";
export type CoveragePattern = "classic" | "reverse" | "pressure" | "pullback";

const PATTERNS: Record<CoveragePattern, Record<CoverageRole, CoverageFraming>> = {
  classic: { setup: "master", peak: "ots", answer: "cu", land: "tight_two" },
  reverse: { setup: "dirty", peak: "cu", answer: "reaction", land: "master" },
  pressure: { setup: "tight_two", peak: "cu", answer: "insert", land: "dirty" },
  pullback: { setup: "ots", peak: "cu", answer: "dirty", land: "master" },
};

const ROTATION: CoveragePattern[] = ["classic", "reverse", "pressure", "pullback"];

export function coveragePatternFor(input: {
  takeIndex?: number | null;
  coverage?: string | null;
}): CoveragePattern {
  if (input.coverage === "room") return "pullback";
  if (input.coverage === "cu") return "pressure";
  if (input.coverage === "single") return "reverse";
  if (input.coverage === "two_shot") return "classic";
  return ROTATION[Math.max(0, input.takeIndex ?? 0) % ROTATION.length]!;
}

export function framingForRole(pattern: CoveragePattern, role: CoverageRole): CoverageFraming {
  return PATTERNS[pattern][role];
}

const COVERAGE_LABELS = ["two_shot", "single", "room", "cu"] as const;

/** After take 1, never reprint the last generation's size — lighting will not match. */
export function joinOpenFraming(input: {
  takeIndex?: number | null;
  coverage?: string | null;
  prevLand?: CoverageFraming | null;
}): CoverageFraming {
  const index = Math.max(0, input.takeIndex ?? 0);
  const planned = framingForRole(coveragePatternFor(input), "setup");
  if (index <= 0) return planned;
  const prev =
    input.prevLand ??
    framingForRole(
      coveragePatternFor({
        takeIndex: index - 1,
        coverage: COVERAGE_LABELS[(index - 1) % COVERAGE_LABELS.length],
      }),
      "land",
    );
  const opened = joinOpenSize(prev);
  return opened === planned && prev === planned ? joinOpenSize(planned) : opened;
}

export const JOIN_CUT_CLAUSE =
  "JOIN CUT. New generation. Do not reprint the previous take's last frame — lamps and skin will not match at the same size. " +
  "Shot 1 changes size (cowboy after an MCU or CU; MCU after a cowboy or insert), with a <swish> on the join. " +
  "Same bodies, same sides, same prop, same key.";

export function coverageStations(pattern: CoveragePattern): CoverageFraming[] {
  return (["setup", "peak", "answer", "land"] as const).map((role) => framingForRole(pattern, role));
}

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function sameFirst(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = firstName(a).toLowerCase();
  const right = firstName(b).toLowerCase();
  return Boolean(left && right && left === right);
}

export function listenerOf(
  speaker: string | null,
  left: string | null,
  right: string | null,
): string | null {
  if (!speaker) return right ?? left;
  if (left && !sameFirst(speaker, left)) return left;
  if (right && !sameFirst(speaker, right)) return right;
  return null;
}

export function coverageDirection(input: {
  framing: CoverageFraming;
  speaker: string | null;
  listener: string | null;
  left: string | null;
  right: string | null;
  upper: string | null;
  prop: string | null;
  beat: string | null;
  mouths: string;
  first: boolean;
  last: boolean;
  entrance: string;
  exit: string;
  join?: boolean;
  prev?: CutShot | null;
}): string {
  const on = cameraWho(input.speaker, input.left, input.right);
  const other = cameraWho(input.listener, input.left, input.right);
  const high = cameraWho(input.upper || input.speaker, input.left, input.right);
  const low = cameraWho(
    [input.left, input.right].find((name) => !sameFirst(name, input.upper || input.speaker)) ?? input.listener,
    input.left,
    input.right,
  );
  // Short label only: the full prop lock is stated once in the prompt body.
  const prop = shortPropLabel(input.prop);
  const beat = input.beat ?? "";
  const move = cutMoveOf(input.prev, { framing: input.framing, on: input.speaker });
  const cut = cutMoveLine(move, input.first, input.join);
  const swish = cutSound(move, input.first && !input.join);
  const hold = "Hold for the whole line, two seconds minimum.";
  const line = "Hold the 180 line.";
  const room = "Same room, same key light.";
  const body = (() => {
    switch (input.framing) {
      case "master":
        return (
          `${cut}${swish} Cowboy of ${on}, head to hips, 3/4 — WIDER than a talking MCU. ` +
          `${other} smaller behind them, never stacked. Key light on the speaker. ${prop} visible where staged. ${line} ${hold} ${input.mouths}`
        );
      case "tight_two":
        return (
          `${cut}${swish} Cowboy of ${on} if standing, else a wide MCU showing the table. ` +
          `${high} holds power by posture; ${low} is one step back. FORBIDDEN: two faces stacked in the 9:16 page. ${room} ${hold} ${input.mouths}`
        );
      case "ots":
        return (
          `${cut}${swish} Over-the-shoulder from behind ${other}: ${on} is the face, chest-up MCU, 3/4, eyes on ${other}, key light on ${on}. ` +
          `${other} is a thin shoulder only, never a foreground cheek. ${hold} ${beat} ${input.mouths}`
        );
      case "dirty":
        return (
          `${cut}${swish} Dirty single on ${on}, chest-up MCU — a new station, not the last size. ` +
          `${other} clips the edge as a thin shoulder. Key light on ${on}. ${hold} ${beat} ${input.mouths}`
        );
      case "cu":
        return (
          `${cut}${swish} Close-up on ${on} only, chin to hairline, a sliver of collar. One face. Key light in the eyes, matte human iris. ` +
          `Slow push-in through the line. ${beat || "Jaw sets."} ${hold} ${input.mouths}`
        );
      case "reaction":
        return (
          `${cut}${swish} Reverse on ${on} only, chest-up MCU from the other side of the line — a NEW face, not the last size. ` +
          `${other} out of frame. ${beat || "The line lands on this face."} ${hold} ${input.mouths}`
        );
      case "insert":
        return (
          `${cut}${swish} INSERT of ${prop} on the table — this exact object from the prop still. Object only, no faces, no hands. ` +
          `Never a substitute box or package. No printed text or logo. Same lamp, same desk. Any speech is off-camera. ${input.mouths}`
        );
    }
  })();
  return `${body}${input.entrance}${input.last ? ` ${input.exit}`.trimEnd() : ""}`.replace(/\s+/g, " ").trim();
}

export const COVERAGE_CLAUSE =
  "COVERAGE. This take CUTS like a filmed dialogue scene, not a stage play. " +
  `${CUT_RULES} ` +
  "Default talking size is chest-up MCU; close-ups are for heat, not the majority; standing is cowboy. " +
  "FORBIDDEN: the same size on the same person twice in a row; two faces stacked in the 9:16 page; a split page; a huge foreground cheek; half-face ECU as the default. " +
  "One relevant person fills the frame, a third stays one step back, never four faces. " +
  "The bodies hold their staged positions and the CAMERA moves around them. 180-degree line holds.";
