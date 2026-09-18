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
 * on the lid. A paper the plot can read — NDA, contract, letter — is written
 * first, then typeset. A date is 10.
 */
export function isReadableDocument(name?: string | null): boolean {
  return /\b(nda|contract|letter|newspaper|receipt|clause|deed|will|agreement|memo|notice|summons)\b/i.test(
    (name ?? "").trim(),
  );
}

export type WrittenDocument = {
  heading: string;
  date: string;
  body: string;
};

/** Date on every document still. Same symbolic 10 as a floor plate. */
export const DOCUMENT_DATE = "10";

/**
 * A readable sample when the writer is unavailable. Real English, named
 * parties, date 10 — never lorem or dummy brands the image model can scramble.
 */
export function fallbackDocument(input: {
  name: string;
  parties?: ReadonlyArray<string>;
  title?: string;
  logline?: string;
}): WrittenDocument {
  const parties = (input.parties ?? []).map((row) => row.trim()).filter(Boolean);
  const a = parties[0] ?? "the disclosing party";
  const b = parties[1] ?? "the receiving party";
  const name = (input.name ?? "").trim();
  const heading = /\bnda\b/i.test(name)
    ? "NON-DISCLOSURE AGREEMENT"
    : /\bcontract|agreement\b/i.test(name)
      ? "AGREEMENT"
      : /\bletter\b/i.test(name)
        ? "LETTER"
        : /\bdeed\b/i.test(name)
          ? "DEED"
          : /\breceipt\b/i.test(name)
            ? "RECEIPT"
            : "NOTICE";
  const matter = (input.logline ?? input.title ?? name).trim().slice(0, 120);
  return {
    heading,
    date: DOCUMENT_DATE,
    body: [
      `This ${heading.toLowerCase()} is made on ${DOCUMENT_DATE} between ${a} and ${b}.`,
      `1. The receiving party will keep confidential all information marked as such about ${matter || "this matter"}.`,
      `2. The information may be used only for the purpose described in this paper.`,
      `3. Copies stay with the receiving party and are returned on written request.`,
      `4. This paper is governed by the law of the place where it is signed.`,
      `Signed on ${DOCUMENT_DATE}.`,
    ].join("\n"),
  };
}

export function normalizeWrittenDocument(raw: unknown, fallback: WrittenDocument): WrittenDocument {
  const value = (raw ?? {}) as Record<string, unknown>;
  const heading = String(value.heading ?? "").trim().slice(0, 80);
  const body = String(value.body ?? "").trim().slice(0, 1800);
  const words = body.split(/\s+/).filter(Boolean);
  if (!heading || words.length < 20) return fallback;
  if (/lorem|ipsum|asdf|qwerty|xxxx|dummy|sample copy|garbled/i.test(`${heading}\n${body}`)) return fallback;
  return { heading, date: DOCUMENT_DATE, body };
}

export function formatDocumentText(doc: WrittenDocument): string {
  return [doc.heading, `Date ${doc.date}`, doc.body].filter(Boolean).join("\n");
}

export function documentFromMeta(meta: Record<string, unknown> | null | undefined): WrittenDocument | null {
  const raw = meta?.document;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const heading = typeof value.heading === "string" ? value.heading.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!heading && !body) return null;
  return {
    heading,
    date: typeof value.date === "string" && value.date.trim() ? value.date.trim() : DOCUMENT_DATE,
    body,
  };
}

/** Exact words the image model must typeset. Never "no readable text". */
export function documentTypeset(doc: WrittenDocument): string {
  return (
    `Typeset this exact document. The paper shows ONLY these words, letter-perfect, in a real typeface. ` +
    `Do not invent extra words. Do not scramble letters. Do not write dummy brands.\n` +
    `HEADING: ${doc.heading}\nDATE: ${doc.date}\n${doc.body}`
  );
}

export function documentPrompt(name: string, doc: WrittenDocument): string {
  return `${name}, a real printed page on a plain dark surface, object only, no people, no hands, no brand, cinematic still. ${documentTypeset(doc)}`;
}

export function objectLettering(name?: string | null): string {
  const text = (name ?? "").trim();
  if (/\b(ring|watch|jewel|necklace|locket|bracelet|earring)\b/i.test(text)) {
    return "The object has no printed lettering. Blank lid and lining. No brand, no date, no name.";
  }
  if (isReadableDocument(text)) {
    return (
      "Typeset the exact words given in the description, letter-perfect. " +
      `A date reads ${DOCUMENT_DATE}. No dummy brands, no sample copy, no garbled names.`
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
  // A document has to show real words. "No readable text" is how the image
  // model invents NDAEM / Sleaked 2016. The writer supplies the lines; the
  // still typesets them.
  const lettering = isReadableDocument(name)
    ? "printed with the exact words given, letter-perfect, no dummy brands"
    : "no readable text, no logo";
  return {
    key,
    name,
    state,
    seedKey: seedState ? `prop:text:${slug}:${seedState}` : null,
    prompt: `${text}${state ? `, ${state} state` : ""}, alone on a plain dark surface, object only, no people, no hands, no brand, ${lettering}, cinematic still`,
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
