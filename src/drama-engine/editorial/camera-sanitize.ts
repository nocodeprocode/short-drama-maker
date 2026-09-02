import { LOCKED_TAKE_CLAUSE } from "../craft/prompt-fragments.ts";

const TWO_SHOT_PHRASES = [
  // Over-the-shoulder language puts a second body in a "single"; the model draws it.
  /\bOTS\b(?:\s+single)?/g,
  /\bover[- ]the[- ]shoulder\b/gi,
  /\bfrom (?:just )?behind [A-Z][a-z]+(?:'s)? (?:left |right )?shoulder\b/g,
  /\b(?:with )?[A-Z][a-z]+(?:'s)? (?:blurred |soft )?(?:shoulder|back|silhouette|profile) (?:in|fills?|frames?) (?:the )?(?:foreground|frame edge|left|right)\b/g,
  /\b[A-Z][a-z]+ in (?:the )?(?:soft )?foreground\b/g,
  /\btwo-shot\b/gi,
  /\btwo shot\b/gi,
  /\bboth of them\b/gi,
  /\bboth characters\b/gi,
  /\bthe couple\b/gi,
  /\bwide enough to (?:hold|see) both\b/gi,
  /\bhim and her\b/gi,
  /\bher and him\b/gi,
  /\bin the same frame\b/gi,
];

const EDIT_VERBS = [
  /\bcut\s+to\b/gi,
  /\bsmash(?:\s+cut)?\b/gi,
  /\bshot\s+\d+\s*:/gi,
  /\bhold\s+for\s+\d+(?:\.\d+)?\s*(?:s|sec|seconds?)?\b/gi,
  /\bthen\s+cut\b/gi,
  /\bjump\s+cut\b/gi,
  /\bhard\s+cut\b/gi,
  /\bmatch\s+cut\b/gi,
  /\bwhip\s+pan\s+to\b/gi,
];

export function containsEditVerb(camera: string): boolean {
  const stripped = camera
    .replace(/single continuous take[\s\S]*/i, "")
    .replace(/\bno\s+(?:cuts|smash(?:\s+cuts)?|shot\s+changes)\b/gi, " ");
  return EDIT_VERBS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(stripped);
  });
}

function nameTokens(name: string): string[] {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 1);
  return [...new Set([name.trim(), ...parts])];
}

/**
 * Drop every clause of a single's camera string that mentions another cast
 * member. A "framing element" shoulder or a "chignon at the frame edge" is a
 * second person to the video model, whatever the prose calls it.
 */
export function dropClausesMentioning(camera: string, names: readonly string[]): string {
  const tokens = names.flatMap(nameTokens).filter(Boolean);
  if (!tokens.length) return camera;
  const pattern = new RegExp(`\\b(?:${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:'s)?\\b`);
  return camera
    .split(/(?<=[.;:])\s+|,\s+/)
    .filter((clause) => !pattern.test(clause))
    .join(", ")
    .replace(/,\s*,/g, ",")
    .trim();
}

export function sanitizeCamera(
  camera: string,
  opts?: { lockedTake?: boolean; single?: boolean; onCameraName?: string | null; otherNames?: readonly string[] },
): string {
  let out = camera ?? "";
  for (const pattern of EDIT_VERBS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, " ");
  }
  if (opts?.single !== false) {
    for (const pattern of TWO_SHOT_PHRASES) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, " tight single ");
    }
    if (opts?.otherNames?.length) {
      const others = opts.otherNames.filter((name) => !opts.onCameraName || !sameName(name, opts.onCameraName));
      out = dropClausesMentioning(out, others);
    }
  }
  out = out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  out = out.replace(/^[,:;.\-\s]+/, "").trim();
  if (opts?.lockedTake !== false && !/single continuous take/i.test(out)) {
    out = out ? `${out}. ${LOCKED_TAKE_CLAUSE}` : LOCKED_TAKE_CLAUSE;
  }
  return out;
}

/** "Mara" and "Mara Voss" are the same person; the planner uses both. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return true;
  const first = (name: string) => name.split(/\s+/)[0] ?? name;
  return first(left) === first(right) || left.startsWith(right) || right.startsWith(left);
}

export function cameraHasLockedTakeClause(camera: string): boolean {
  return /single continuous take/i.test(camera);
}
