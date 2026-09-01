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
