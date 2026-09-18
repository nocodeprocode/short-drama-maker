/**
 * Production design slate: the places and the objects a show needs, kept apart
 * from the people who play in it.
 *
 * A cast slot is a face. A location is an empty room we shoot in from several
 * angles. A prop is an object on a plain surface. The genre playbooks already
 * carry both — `setPieces` are rooms and `visualMotifs` are a mix of rooms and
 * objects — so the slate reads them and sorts them instead of asking a model.
 *
 * Kept in lockstep with supabase/functions/_shared/design-slate.ts
 * (parity: src/lib/design-slate-parity.test.ts).
 */

import { inferGenre, playbookFor } from "../../drama-engine/craft/genre-playbooks.ts";
import type { GenreId } from "../../drama-engine/types/genre.ts";

export { inferGenre };

export type DesignKind = "location" | "prop";

export type DesignSlateRow = {
  kind: DesignKind;
  name: string;
  note: string;
  position: number;
};

export type DesignSlate = {
  locations: DesignSlateRow[];
  props: DesignSlateRow[];
};

export const DESIGN_LOCATION_MAX = 8;
export const DESIGN_PROP_MAX = 6;
export const DESIGN_LOCATION_MIN = 3;
export const DESIGN_PROP_MIN = 2;

/**
 * Some playbooks describe their set pieces as beats ("wake node", "memory
 * cluster") and name no room at all. A slate still has to show the buyer
 * somewhere to shoot, so these fill the gap until the story names its own.
 */
const FALLBACK_LOCATIONS = ["glass office", "penthouse living room", "hospital corridor", "city street at night"];
const FALLBACK_PROPS = ["sealed letter", "face-down phone", "closed contract folder"];

/** A place we can stand a camera in. Wins over an object word in the same phrase. */
const PLACE_NEEDLE =
  /\b(office|penthouse|hall|corridor|gala|elevator|car|warehouse|church|room|house|gate|banquet|palace|boardroom|board|gallery|table|doorway|safehouse|study|wedding|hospital|street|apartment|kitchen|bar|club|garden|courtyard|lobby|rooftop|alley|estate|mansion|suite|bedroom|stairwell|dock|station|temple|shrine|prison|courtroom)\b/i;

/**
 * Playbook shorthand the image model will misread if we send it as-is.
 * "board" is a film clapperboard. "board vote" is a beat, not a room.
 */
const PLACE_EXPAND: Record<string, string> = {
  board: "boardroom",
  "board vote": "boardroom",
};

/** The name we actually generate and store, so the plate is a room. */
export function expandPlaceName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  return PLACE_EXPAND[trimmed.toLowerCase()] ?? trimmed;
}

/** An object we can shoot alone on a surface. */
const OBJECT_NEEDLE =
  /\b(nda|contract|ring|box|letter|envelope|locket|receipt|receipts|seal|edict|token|watch|phone|chart|deed|clause|mark|sheet|ledger|badge|newspaper|carrier|dna|insert|jacket|lamp|lock-screen|bill|folder|key|keys|photograph|ticket)\b/i;

/**
 * Directions to the camera department, not things we can generate: a gun we
 * refuse to put on camera, a tattoo that lives on a body, a catchphrase.
 */
const SKIP_NEEDLE = /\b(implied|off-frame|catchphrase|timeline|morph|tattoo|tattoos|gun|guns|blood)\b/i;

const LOCATION_NOTE =
  "Empty set, no people. One motivated light and grade, cinematic 9:16 still.";
const PROP_NOTE =
  "Object alone on a plain dark surface. No people, no hands, no brand, no readable text.";

/** The phrase up to and including its last matching word, so a qualifier tail falls off. */
function truncateToLastMatch(text: string, needle: RegExp): string {
  const words = text.split(/\s+/);
  let last = -1;
  for (const [index, word] of words.entries()) {
    if (needle.test(word)) last = index;
  }
  if (last < 0) return text.trim();
  return words.slice(0, last + 1).join(" ").trim();
}

function cleanFragment(raw: string): string {
  return raw
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One playbook phrase can hold two things ("chart / contract insert"). */
function fragmentsOf(phrase: string): string[] {
  return phrase
    .split("/")
    .map(cleanFragment)
    .filter((part) => part.length > 1);
}

export function classifyDesignPhrase(phrase: string): { kind: DesignKind; name: string } | null {
  const text = cleanFragment(phrase);
  if (!text || SKIP_NEEDLE.test(text)) return null;
  if (PLACE_NEEDLE.test(text)) {
    return { kind: "location", name: expandPlaceName(truncateToLastMatch(text, PLACE_NEEDLE)) };
  }
  if (OBJECT_NEEDLE.test(text)) {
    return { kind: "prop", name: truncateToLastMatch(text, OBJECT_NEEDLE) };
  }
  return null;
}

/** The object half of a device nuke: "hidden heir / leaked NDA" is the NDA. */
export function propsFromArchetype(archetype: string): string[] {
  const out: string[] = [];
  for (const fragment of fragmentsOf(archetype)) {
    const hit = classifyDesignPhrase(fragment);
    if (hit?.kind !== "prop") continue;
    const whole = archetype.toLowerCase();
    const name = hit.name.toLowerCase();
    if (name.includes("clause")) {
      out.push(/\b(owner|wrote|ownership)\b/.test(whole) ? "ownership contract" : "contract clause");
    } else if (name === "test" && /\bdna\b/.test(whole)) {
      out.push("DNA test results");
    } else {
      out.push(hit.name);
    }
  }
  return out;
}

/**
 * Whether two names are the same thing said at two lengths — the playbook's
 * "NDA" and the plot's "leaked NDA". Whole words only, so "car" and "carrier"
 * stay apart.
 */
export function sameDesignThing(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  return new RegExp(`\\b${shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(longer);
}

export function buildDesignSlate(input: {
  title?: string;
  idea?: string;
  genre?: GenreId;
  /** Archetypes of slots the cast sheet marked as story elements, not faces. */
  deviceArchetypes?: string[];
}): DesignSlate {
  const genre = input.genre ?? inferGenre(`${input.title ?? ""} ${input.idea ?? ""}`);
  const playbook = playbookFor(genre);

  const locations: DesignSlateRow[] = [];
  const props: DesignSlateRow[] = [];
  const seen = new Set<string>();

  const add = (kind: DesignKind, name: string) => {
    const key = `${kind}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    const bucket = kind === "location" ? locations : props;
    // The same thing named twice is one thing. Keep the more specific name, in
    // the place the first one held, so nothing is built twice.
    const twin = bucket.find((row) => sameDesignThing(row.name, name));
    if (twin) {
      if (name.length > twin.name.length) {
        seen.delete(`${kind}:${twin.name.toLowerCase()}`);
        seen.add(key);
        twin.name = name;
      }
      return;
    }
    const cap = kind === "location" ? DESIGN_LOCATION_MAX : DESIGN_PROP_MAX;
    if (bucket.length >= cap) return;
    seen.add(key);
    bucket.push({
      kind,
      name,
      note: kind === "location" ? LOCATION_NOTE : PROP_NOTE,
      position: bucket.length,
    });
  };

  // Set pieces are where the show is shot, so they seed the location list.
  for (const phrase of playbook.setPieces) {
    for (const fragment of fragmentsOf(phrase)) {
      const hit = classifyDesignPhrase(fragment);
      if (hit?.kind === "location") add("location", hit.name);
    }
  }
  // Motifs are mixed: "glass office" is a room, "ring box" is an object.
  for (const phrase of playbook.visualMotifs) {
    for (const fragment of fragmentsOf(phrase)) {
      const hit = classifyDesignPhrase(fragment);
      if (hit) add(hit.kind, hit.name);
    }
  }
  // A cast slot we refused to cast is usually the object the plot turns on.
  for (const archetype of input.deviceArchetypes ?? []) {
    for (const name of propsFromArchetype(archetype)) add("prop", name);
  }

  for (const name of FALLBACK_LOCATIONS) {
    if (locations.length >= DESIGN_LOCATION_MIN) break;
    add("location", name);
  }
  for (const name of FALLBACK_PROPS) {
    if (props.length >= DESIGN_PROP_MIN) break;
    add("prop", name);
  }

  return { locations, props };
}

/** Asset key for a prop still, matching what the engine's prop bible looks up. */
export function propAssetKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `prop:text:${slug}`;
}

/** The engine's cached prop kinds, so a design prop reuses that plate. */
export function propKindFor(name: string): string | null {
  const text = name.toLowerCase();
  if (/\b(carrier|pup|puppy|collar)\b/.test(text)) return "carrier";
  if (/\b(watch|wrist)\b/.test(text)) return "watch";
  if (/\b(phone|lock-screen|lock screen)\b/.test(text)) return "phone";
  if (/\b(contract|nda|folder|clause)\b/.test(text)) return "contract";
  if (/\b(letter|paper|envelope|note|receipt|receipts)\b/.test(text)) return "letter";
  return null;
}
