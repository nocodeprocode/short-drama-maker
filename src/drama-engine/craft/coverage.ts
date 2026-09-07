import { cameraWho } from "./seedance-speech.ts";

/**
 * Dialogue coverage. A scene is not one camera.
 *
 * Classic coverage: master, over-the-shoulder, reverse, clean/dirty singles,
 * close-ups, inserts. Size goes wider to tighter as heat rises. The 180-degree
 * line holds so camera-left stays camera-left. Consecutive shots must change
 * size or station — a held side-profile two-shot is a stage play, not a cut.
 *
 * Vertical drama uses the same grammar on the Z-axis: closer,
 * slightly behind one person, then the other, then both faces near the lens.
 */

export type CoverageFraming = "master" | "tight_two" | "ots" | "dirty" | "cu" | "reaction";
export type CoverageRole = "setup" | "peak" | "answer" | "land";
export type CoveragePattern = "classic" | "reverse" | "pressure" | "pullback";

const PATTERNS: Record<CoveragePattern, Record<CoverageRole, CoverageFraming>> = {
  classic: { setup: "master", peak: "ots", answer: "dirty", land: "tight_two" },
  reverse: { setup: "dirty", peak: "cu", answer: "reaction", land: "ots" },
  pressure: { setup: "tight_two", peak: "cu", answer: "reaction", land: "dirty" },
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
  const prefer: CoverageFraming = prev === "cu" || prev === "reaction" ? "tight_two" : index % 2 === 1 ? "cu" : "tight_two";
  return prefer === prev ? (prefer === "cu" ? "tight_two" : "cu") : prefer;
}

export const JOIN_CUT_CLAUSE =
  "JOIN CUT. This is a new generation. Do not reprint the previous take's last frame. " +
  "Wet ground, lamps, and skin highlights will not match if the size stays the same. " +
  "Shot 1 MUST change size: a chin-to-hairline close-up, or both faces stacked near the lens (a tight two). " +
  "Same bodies, same sides, same prop, same plate key. Never open on the same two-shot of the room.";

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
}): string {
  const on = cameraWho(input.speaker, input.left, input.right);
  const other = cameraWho(input.listener, input.left, input.right);
  const high = cameraWho(input.upper || input.speaker, input.left, input.right);
  const low = cameraWho(
    [input.left, input.right].find((name) => !sameFirst(name, input.upper || input.speaker)) ?? input.listener,
    input.left,
    input.right,
  );
  const prop = input.prop?.trim() || "the locked prop";
  const beat = input.beat ?? "";
  const cut = input.first
    ? input.join
      ? "JOIN CUT. NEW CAMERA. Different size than the last generation. Do not reprint that last frame."
      : "NEW CAMERA."
    : "HARD CUT. New camera position. Do not hold the previous frame.";
  const hold = "Hold this shot for the entire line, two seconds minimum. This is not a one-frame flash.";
  const line = "Keep the 180-degree line: camera-left stays camera-left, camera-right stays camera-right.";
  const body = (() => {
    switch (input.framing) {
      case "master":
        return (
          `${cut} Both upper bodies in frame, FaceTime-close, 3/4 — the For You page distance, not a tiny wide. ` +
          `Faces large enough to read beauty: eyes, mouth, skin. You are never too far. ` +
          `Camera sits closer to camera-left, slightly off the profile axis — NOT a flat side-on iPhone profile. ` +
          `${prop} is visible where staged. ${line} ${input.mouths}`
        );
      case "tight_two":
        return (
          `${cut} Both faces close to the lens, stacked in the vertical frame: ${high} holds the upper frame, ${low} lower. ` +
          `This is closer than a medium two-shot. Faces large, shoulders in. NOT a wide profile. ${hold} ${input.mouths}`
        );
      case "ots":
        return (
          `${cut} Over-the-shoulder: camera slightly behind ${other}, over ${other}'s near shoulder. ` +
          `${on} is the face we see, 3/4 toward camera, eyes on ${other}. ` +
          `${other} is only a shoulder and a sliver of jaw in the foreground, soft. ${hold} ${beat} ${input.mouths}`
        );
      case "dirty":
        return (
          `${cut} Dirty single on ${on}: medium close-up, closer than the last shot. ` +
          `${other}'s shoulder or profile sits in the near edge of frame. ${on} fills the upper third. ${hold} ${beat} ${input.mouths}`
        );
      case "cu":
        return (
          `${cut} Real close-up on ${on} only, chin to hairline, a sliver of the same place in the corners. ` +
          `Slow push-in through the line. ${beat || "Eyes lock, jaw sets."} ${hold} ${input.mouths}`
        );
      case "reaction":
        return /\b(stun|freeze|eye|breath|scared|oh my)\b/i.test(beat)
          ? (
              `${cut} One-second extreme close-up on ${on}'s eye or mouth. They breathe. Then cut. Do not hold a long expression. ` +
              `${input.mouths}`
            )
          : (
              `${cut} Reverse close-up on ${on} only — the matching angle from the other side of the line. ` +
              `Chin to hairline. ${other} is not in frame. ${beat || "The line lands on this face."} ${hold} ${input.mouths}`
            );
    }
  })();
  return `${body}${input.entrance}${input.last ? ` ${input.exit}`.trimEnd() : ""}`.replace(/\s+/g, " ").trim();
}

export const COVERAGE_CLAUSE =
  "COVERAGE. This take CUTS like a filmed dialogue scene, not a stage play. " +
  "Each numbered shot is a different camera station or a different size. " +
  "Legal stations: both upper bodies FaceTime-close, over-the-shoulder, a dirty single, a held close-up, " +
  "a one-second eye ECU on a stun, the reverse, both faces stacked near the lens, a half-step that still keeps faces large, punch in on a doorway. " +
  "FORBIDDEN: staying on one side-profile two-shot; a close-up that lasts one frame then snaps back; " +
  "cutting back to the same camera position; a tiny wide that loses the faces; any frame where you cannot read the eyes; a prestige locked master. " +
  "Most of the take is faces. You are never too far from the people. " +
  "Both people stay in their staged positions. The CAMERA moves around them. " +
  "180-degree line holds. Same place, same key light. " +
  "A new take never opens on the same size as the last take ended.";
