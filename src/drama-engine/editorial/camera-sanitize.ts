import { LOCKED_TAKE_CLAUSE } from "../craft/prompt-fragments.ts";

const TWO_SHOT_PHRASES = [
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

export function sanitizeCamera(camera: string, opts?: { lockedTake?: boolean; single?: boolean }): string {
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
  }
  out = out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  out = out.replace(/^[,:;.\-\s]+/, "").trim();
  if (opts?.lockedTake !== false && !/single continuous take/i.test(out)) {
    out = out ? `${out}. ${LOCKED_TAKE_CLAUSE}` : LOCKED_TAKE_CLAUSE;
  }
  return out;
}

export function cameraHasLockedTakeClause(camera: string): boolean {
  return /single continuous take/i.test(camera);
}
