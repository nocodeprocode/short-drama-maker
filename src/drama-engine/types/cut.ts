/**
 * Genre-agnostic cut law. Writer, coverage, prompt, and lint share this clause.
 *
 * AI generations never match lighting or skin grain across a reprint. A cut that
 * stays the same size on the same person makes that jump obvious. A cut that
 * changes size, changes who is pictured, or goes to the object on the table
 * hides the artifact — that is the whole reason coverage exists here.
 */

export const CUT_RULES =
  "CUT. Every cut MUST move: closer, further, the other person, or an insert of the prop. " +
  "Never the same size on the same person — that reprint makes the lamp and the face jump. " +
  "Ladder: cowboy → chest-up MCU → close-up on heat → insert → reverse. " +
  "A hard cut carries a <swish>; a push-in is a slow zoom, not a jump-cut.";

export type CutSize = "cowboy" | "mcu" | "cu" | "insert";
export type CutMove = "closer" | "wider" | "reverse" | "insert";
export type CutFraming = "master" | "tight_two" | "ots" | "dirty" | "cu" | "reaction" | "insert";

export type CutShot = {
  framing: CutFraming;
  on?: string | null;
};

export type CutHit = {
  kind: "same_size_same_face" | "join_reprint";
  detail: string;
};

const SIZE_RANK: Record<CutSize, number> = {
  cowboy: 0,
  mcu: 1,
  cu: 2,
  insert: 3,
};

export function sizeOfFraming(framing: CutFraming): CutSize {
  switch (framing) {
    case "master":
    case "tight_two":
      return "cowboy";
    case "ots":
    case "dirty":
    case "reaction":
      return "mcu";
    case "cu":
      return "cu";
    case "insert":
      return "insert";
  }
}

function fold(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

export function sameSubject(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = fold(a);
  const right = fold(b);
  return Boolean(left && right && left === right);
}

export function cutMoveOf(prev: CutShot | null | undefined, next: CutShot): CutMove | null {
  if (!prev) return null;
  const nextSize = sizeOfFraming(next.framing);
  if (nextSize === "insert") return "insert";
  if (!sameSubject(prev.on, next.on) && fold(next.on)) return "reverse";
  const prevRank = SIZE_RANK[sizeOfFraming(prev.framing)];
  const nextRank = SIZE_RANK[nextSize];
  if (nextRank > prevRank) return "closer";
  if (nextRank < prevRank) return "wider";
  return null;
}

/** True when the cut changes size, subject, or goes to the prop. */
export function cutIsLegal(prev: CutShot | null | undefined, next: CutShot): boolean {
  if (!prev) return true;
  if (sizeOfFraming(next.framing) === "insert") return true;
  if (sizeOfFraming(prev.framing) === "insert") return true;
  if (sizeOfFraming(prev.framing) !== sizeOfFraming(next.framing)) return true;
  if (fold(next.on) && !sameSubject(prev.on, next.on)) return true;
  return false;
}

const REPAIR_BY_SIZE: Record<CutSize, CutFraming[]> = {
  cowboy: ["dirty", "ots", "cu", "insert"],
  mcu: ["cu", "master", "tight_two", "insert"],
  cu: ["master", "tight_two", "dirty", "insert"],
  insert: ["dirty", "master", "cu"],
};

/**
 * If the planned framing reprints the last size on the same face, step to the
 * next legal station. Prefer a size change; reverse or insert if that is all
 * that is left.
 */
export function repairCutFraming(
  prev: CutShot | null | undefined,
  planned: CutFraming,
  on: string | null,
  prop?: string | null,
): CutFraming {
  const use = planned === "insert" && !prop?.trim() ? "reaction" : planned;
  const next = { framing: use, on };
  if (cutIsLegal(prev, next)) return use;
  const candidates = REPAIR_BY_SIZE[prev ? sizeOfFraming(prev.framing) : "mcu"] ?? ["cu", "master", "insert"];
  for (const framing of candidates) {
    if (framing === "insert" && !prop?.trim()) continue;
    if (cutIsLegal(prev, { framing, on })) return framing;
  }
  return planned === "cu" ? "master" : "cu";
}

export function cutSound(move: CutMove | null, first?: boolean): string {
  if (first && !move) return "";
  if (move === "insert") return " <whoosh> Smash to the object — this hides the lighting join.";
  if (move === "reverse") return " <whoosh> Whip to the other person. New face, new size if you can.";
  if (move === "closer") return " <swish> Cut closer. Slow push-in as the cut lands. Do not reprint the last size.";
  if (move === "wider") return " <swish> Cut wider. Pull back one station. The last face does not stay this big.";
  return " <swish> The camera moves. The last frame is gone.";
}

export function cutMoveLine(move: CutMove | null, first?: boolean, join?: boolean): string {
  if (join) {
    return "JOIN CUT. NEW SIZE. <swish> Do not reprint the last generation's last frame — the lamp will not match.";
  }
  if (first || !move) return "NEW CAMERA.";
  switch (move) {
    case "closer":
      return "HARD CUT CLOSER. New size. Do not hold the previous frame.";
    case "wider":
      return "HARD CUT WIDER. New size. Do not hold the previous frame.";
    case "reverse":
      return "HARD CUT REVERSE. The other person. Do not hold the previous frame.";
    case "insert":
      return "HARD CUT INSERT. The locked prop on the table. No faces. Do not hold the previous frame.";
  }
}

export function joinOpenSize(prevLand?: CutFraming | null): CutFraming {
  const prev = prevLand ? sizeOfFraming(prevLand) : null;
  if (prev === "cowboy") return "dirty";
  if (prev === "cu") return "master";
  if (prev === "insert") return "dirty";
  return "master";
}

export function cutProblems(shots: readonly CutShot[], prevLand?: CutFraming | null): CutHit[] {
  const hits: CutHit[] = [];
  if (prevLand && shots[0]) {
    const open = sizeOfFraming(shots[0].framing);
    if (open === sizeOfFraming(prevLand) && open !== "insert") {
      hits.push({
        kind: "join_reprint",
        detail: `opens on ${open} after a ${sizeOfFraming(prevLand)} land — lighting will jump`,
      });
    }
  }
  for (let index = 1; index < shots.length; index += 1) {
    const prev = shots[index - 1]!;
    const next = shots[index]!;
    if (cutIsLegal(prev, next)) continue;
    hits.push({
      kind: "same_size_same_face",
      detail: `shot ${index + 1} reprints ${sizeOfFraming(next.framing)} on ${fold(next.on) || "the same face"}`,
    });
  }
  return hits;
}
