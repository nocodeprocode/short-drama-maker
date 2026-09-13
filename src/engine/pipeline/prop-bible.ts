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
 * Lettering on an object plate.
 *
 * Prefer none. A ring box does not need a jeweller's name, and asking the
 * model to "keep printed names readable" is how ESTHERY / Mer Yandex lands
 * on the lid. If the object is a document that must show a word, that word
 * is one real heading — never dummy brands or sample copy. A date is 10.
 */
export function objectLettering(name?: string | null): string {
  const text = (name ?? "").trim();
  if (/\b(ring|watch|jewel|necklace|locket|bracelet|earring)\b/i.test(text)) {
    return "The object has no printed lettering. Blank lid and lining. No brand, no date, no name.";
  }
  if (/\b(nda|contract|letter|newspaper|receipt|clause|deed|folder|envelope)\b/i.test(text)) {
    return (
      "If this document must show a heading, one short real heading only. " +
      "A date reads 10. No dummy brands, no sample copy, no garbled names."
    );
  }
  return "No printed lettering on the object. No brand, no date, no name, unless this object is a document that must show one real heading.";
}

/** Extra stills of the same object when it has two faces or an open state. */
export type ObjectView = { angle: string; prompt: string };

export const OBJECT_ANGLE_KIND = "object_angle";

const OBJECT_VIEW_LABELS: Record<string, string> = {
  reverse: "Back",
  open: "Open",
  profile: "Edge",
};

export function objectViewLabel(angle: string): string {
  return OBJECT_VIEW_LABELS[angle] ?? angle.replaceAll("_", " ");
}

/**
 * Only objects that change when you turn them or open them.
 * A lamp is one picture. A contract has a back. A ring box opens.
 */
export function objectViews(name?: string | null): ObjectView[] {
  const text = (name ?? "").trim();
  if (!text) return [];
  if (/\b(box|envelope|carrier)\b/i.test(text)) {
    return [
      {
        angle: "open",
        prompt: "the same object open, lid or flap up, same object, same lining, same surface",
      },
    ];
  }
  if (/\b(nda|contract|letter|newspaper|receipt|clause|deed|folder|paper|note)\b/i.test(text)) {
    return [
      {
        angle: "reverse",
        prompt: "the same object from the back, same paper, same size, same surface",
      },
    ];
  }
  if (/\bphone\b/i.test(text)) {
    return [
      {
        angle: "reverse",
        prompt: "the same phone flipped to the other face, same device, same surface, screen off",
      },
    ];
  }
  if (/\bwatch\b/i.test(text)) {
    return [
      {
        angle: "profile",
        prompt: "the same watch from the side, clasp and edge visible, same watch, same surface",
      },
    ];
  }
  return [];
}

/**
 * Any story's prop, from the planner's own words ("the same soaked parcel on
 * the wet ground"). The fixed kinds above are only a cache for the commonest
 * objects; this is what makes the prop bible work for any script.
 */
export function propFromLockText(prop?: string | null): {
  key: string;
  name: string;
  prompt: string;
  state: string | null;
  seedKey: string | null;
} | null {
  const raw = (prop ?? "").trim();
  const state = /STATE\s+(sealed|broken|open|closed|face-down)\b/i.exec(raw)?.[1]?.toLowerCase() ?? null;
  const text = raw
    .replace(/^the same\s+/i, "")
    .replace(/\s+STATE\s+\S+:.*$/i, "")
    .replace(/\s+(on|in|at|between|beside|under)\s+.*$/i, "")
    .replace(/[.]+$/, "")
    .trim();
  if (!text || (/\b(object|prop)\b/i.test(text) && text.split(/\s+/).length <= 3)) return null;
  const name = text.toLowerCase();
  const slug = name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const key = state ? `prop:text:${slug}:${state}` : `prop:text:${slug}`;
  const seedState = state && state !== "sealed" && state !== "closed" ? "sealed" : null;
  return {
    key,
    name,
    state,
    seedKey: seedState ? `prop:text:${slug}:${seedState}` : null,
    prompt: `${text}${state ? `, ${state} state` : ""}, alone on a plain dark surface, object only, no people, no hands, no brand, no readable text, no logo, cinematic still`,
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
