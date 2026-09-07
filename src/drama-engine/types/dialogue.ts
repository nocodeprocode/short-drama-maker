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
