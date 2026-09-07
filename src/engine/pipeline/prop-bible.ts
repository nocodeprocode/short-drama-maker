export const PROP_BIBLE_KINDS = ["letter", "phone", "contract", "watch", "carrier"] as const;
export type PropKind = (typeof PROP_BIBLE_KINDS)[number];
export const PROP_KIND = "prop";

export const PROP_PROMPTS: Record<PropKind, string> = {
  letter: "Unlabeled folded letter on dark stone, cream paper, no readable writing, no printed name, no date, object only",
  phone: "Face-down dark phone on a walnut desk, screen off, no logos, no readable UI, object only",
  contract: "Closed contract folder on a desk, blank cover, no printed title, no signatures visible, object only",
  watch: "Closed luxury watch on dark wood, face turned away, no brand name, no readable numerals, object only",
  carrier: "Closed pet carrier on a counter, dark plastic, no brand, no readable tag, latch closed, object only, no animals visible",
};

export function propKey(kind: PropKind): string {
  return `prop:${kind}`;
}

/**
 * Any story's prop, from the planner's own words ("the same soaked parcel on
 * the wet ground"). The fixed kinds above are only a cache for the commonest
 * objects; this is what makes the prop bible work for any script.
 */
export function propFromLockText(prop?: string | null): { key: string; name: string; prompt: string } | null {
  const text = (prop ?? "")
    .replace(/^the same\s+/i, "")
    .replace(/\s+(on|in|at|between|beside|under)\s+.*$/i, "")
    .replace(/[.]+$/, "")
    .trim();
  if (!text || /\b(object|prop)\b/i.test(text) && text.split(/\s+/).length <= 3) return null;
  const name = text.toLowerCase();
  return {
    key: `prop:text:${name.replace(/[^a-z0-9]+/g, "-")}`,
    name,
    prompt: `${text}, alone on a plain dark surface, object only, no people, no hands, no brand, no readable text, no logo, cinematic still`,
  };
}

export function inferPropKind(camera?: string | null): PropKind | null {
  const text = (camera ?? "").toLowerCase();
  if (/\b(carrier|pup|puppy|collar)\b/.test(text)) return "carrier";
  if (/\b(watch|wrist)\b/.test(text)) return "watch";
  if (/\b(phone|lock screen|desk pad)\b/.test(text)) return "phone";
  if (/\b(contract|nda|folder|clause)\b/.test(text)) return "contract";
  if (/\b(letter|paper|envelope|note|receipt)\b/.test(text)) return "letter";
  return null;
}
