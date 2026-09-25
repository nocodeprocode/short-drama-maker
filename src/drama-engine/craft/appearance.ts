/**
 * Gives a generated character a face of their own.
 *
 * Every generated actor used to be stored with the same appearance profile —
 * `age_look: "adult"`, `face: "adult man"`, hair and heritage left empty — so
 * the only per-character words reaching the image model were the name and a
 * line about what the role does in the plot. The still prompt then opens with
 * "strikingly beautiful adult, camera-ready", and with nothing to distinguish
 * one brief from the next the model fell back on its own house face: every
 * generated man came back as the same man, every woman as the same woman.
 *
 * The traits below are drawn from the name, so a character keeps the same face
 * across retries, across the four angles of a pack, and across a rebuild, while
 * two characters in one show land on visibly different people. They stay inside
 * a camera-ready range on purpose: the cast gate rejects a plain or tired face,
 * so variety has to come from heritage, hair, bone structure, build and one
 * distinguishing mark rather than from making someone unattractive.
 */

export type CastGender = "man" | "woman";

export type CastAppearance = {
  age_look: string;
  ethnicity_notes: string;
  hair: string;
  face: string;
  body: string;
};

/**
 * FNV-1a over the name. Deterministic across Deno, Node and the browser, which
 * a hash built from `Math.random` or `Date.now` would not be: the edge function
 * casts the traits and the engine has to read the same person back.
 */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // FNV's low bits are weak, and a trait table of eight entries is chosen with
  // `% 8` — the low three bits only. Without this finalizer half a cast of six
  // shared one face shape. Same instinct as picking a card off the top of an
  // unshuffled deck.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * One trait per salt, so a shared first letter does not drag every other trait
 * along with it: "Serafina" and "Silas" must not end up with the same hair
 * merely because the same hash picked their heritage.
 */
function pick<T>(name: string, salt: string, table: ReadonlyArray<T>): T {
  return table[hashOf(`${salt}:${name}`) % table.length] as T;
}

/**
 * Hair and eye colour are not free choices. Rolling every trait independently
 * produced honey-blond hair on South Asian heritage and steel-blue eyes on West
 * African heritage: the model either ignores half the line or paints an obvious
 * dye job. Each heritage carries the colours that actually occur with it, and
 * the darker eye palettes double as protection against the cast gate, which
 * keeps rejecting pale irises for lighting themselves up.
 */
const HAIR_COLOUR_WIDE: ReadonlyArray<string> = [
  "blond",
  "honey-blond",
  "ash-brown",
  "light brown",
  "auburn",
  "copper-red",
  "dark brown",
  "black",
];
const HAIR_COLOUR_MID: ReadonlyArray<string> = ["black", "dark brown", "chestnut", "auburn"];
const HAIR_COLOUR_DARK: ReadonlyArray<string> = ["black", "jet-black", "dark brown"];

const EYES_WIDE: ReadonlyArray<string> = [
  "dark brown eyes",
  "warm hazel eyes",
  "grey-blue eyes",
  "olive-green eyes",
  "steel-blue eyes",
  "dark grey eyes",
];
const EYES_MID: ReadonlyArray<string> = [
  "dark brown eyes",
  "deep brown eyes, almost black",
  "warm hazel eyes",
  "olive-green eyes",
  "dark grey eyes",
];
const EYES_DARK: ReadonlyArray<string> = [
  "dark brown eyes",
  "deep brown eyes, almost black",
  "black-brown eyes",
  "dark brown eyes with a warm edge",
];

type Heritage = { notes: string; hair: ReadonlyArray<string>; eyes: ReadonlyArray<string> };

const HERITAGE: ReadonlyArray<Heritage> = [
  { notes: "Northern European heritage, fair skin with a cool undertone", hair: HAIR_COLOUR_WIDE, eyes: EYES_WIDE },
  { notes: "Central European heritage, pale skin with a neutral undertone", hair: HAIR_COLOUR_WIDE, eyes: EYES_WIDE },
  { notes: "Mediterranean heritage, olive skin with a warm undertone", hair: HAIR_COLOUR_MID, eyes: EYES_MID },
  { notes: "Middle Eastern heritage, olive-brown skin with a warm undertone", hair: HAIR_COLOUR_MID, eyes: EYES_MID },
  { notes: "Latin American heritage, tan-brown skin with a warm undertone", hair: HAIR_COLOUR_MID, eyes: EYES_MID },
  { notes: "Slavic heritage, fair skin with a neutral undertone", hair: HAIR_COLOUR_WIDE, eyes: EYES_WIDE },
  { notes: "West African heritage, deep brown skin with a warm undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "East African heritage, dark brown skin with a neutral undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "Afro-Caribbean heritage, rich brown skin with a red undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "South Asian heritage, brown skin with a golden undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "East Asian heritage, light skin with a neutral undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "Southeast Asian heritage, tan skin with a golden undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
  { notes: "Pacific Islander heritage, warm brown skin with a golden undertone", hair: HAIR_COLOUR_DARK, eyes: EYES_DARK },
];

/** Grey arrives with age, not with heritage, so it is added to the pool late. */
const GREYING: ReadonlyArray<string> = ["salt-and-pepper", "greying dark", "silver-streaked black"];

/** Texture, length and styling, written to follow a colour. Any texture suits any heritage. */
const HAIR_CUT: Record<CastGender, ReadonlyArray<string>> = {
  man: [
    "hair cropped close over a sharp hairline",
    "hair, short and side-parted",
    "hair worn medium length and pushed back",
    "hair buzzed short over a faint widow's peak",
    "hair long enough to tie back at the nape",
    "hair in dense curls cut short and high",
    "hair in tight coils kept very short",
    "hair combed flat and slicked back",
    "hair, short and tousled",
    "hair cropped under a heavy fringe",
    "hair, wavy and collar-length",
    "hair, thick and neatly cut",
  ],
  woman: [
    "hair falling straight past the shoulders",
    "hair gathered in a low chignon",
    "hair in waves to the collarbone",
    "hair in a blunt shoulder-length cut",
    "hair in tight curls worn in a high bun",
    "hair in a sleek centre part",
    "hair loose past the shoulder",
    "hair in a sharp bob to the jaw",
    "hair braided and pinned at the back",
    "hair with a soft side part",
    "hair, long and layered",
    "hair twisted up and pinned",
  ],
};

const FACE_SHAPE: ReadonlyArray<string> = [
  "an oval face with high cheekbones and a narrow straight nose",
  "a square face with a broad jaw and a level brow",
  "a heart-shaped face with a pointed chin and wide-set eyes",
  "a long face with a slim aquiline nose and deep-set eyes",
  "a round face with full cheeks and a short nose",
  "a diamond-shaped face with sharp cheekbones and a tapered chin",
  "a broad face with a low nose bridge and almond eyes",
  "an angular face with hollow cheeks and a cut jawline",
];

const MARK: ReadonlyArray<string> = [
  "a small mole above the left lip",
  "faint freckles across the nose and cheeks",
  "a thin scar through the right eyebrow",
  "a dimple in the left cheek when the mouth moves",
  "a narrow gap between the front teeth",
  "a beauty spot below the right eye",
  "a cleft in the chin",
  "one eyebrow set slightly higher than the other",
  "a nose bridge that sits a little off straight",
  "fine lines at the outer corners of the eyes",
];

const BUILD: Record<CastGender, ReadonlyArray<string>> = {
  man: [
    "tall and lean with narrow shoulders",
    "broad-shouldered and heavy through the chest",
    "compact and athletic",
    "tall and wiry with long arms",
    "solid with a thick neck and a deep chest",
    "slim with long limbs and a straight back",
  ],
  woman: [
    "tall and slender",
    "petite and fine-boned",
    "athletic with square shoulders",
    "soft-figured with a full waist",
    "long-limbed and lean",
    "compact with a strong frame",
  ],
};

const AGE_BANDS: ReadonlyArray<string> = [
  "mid twenties",
  "late twenties",
  "early thirties",
  "mid thirties",
  "late thirties",
  "early forties",
  "mid forties",
  "around fifty",
];

/**
 * The slate often already dates a role — "40s", "36", "late twenties" — and a
 * cast trait that contradicts the brief makes the model average the two. When
 * the note says an age, that age wins.
 */
export function ageFromNote(note: string | null | undefined): string | null {
  const text = String(note ?? "");
  const decade = /\b(twenties|thirties|forties|fifties|sixties)\b/i.exec(text);
  const qualifier = decade ? /\b(early|mid|late)\s+$/i.exec(text.slice(0, decade.index)) : null;
  if (decade) {
    const band = decade[1]!.toLowerCase();
    return qualifier ? `${qualifier[1]!.toLowerCase()} ${band}` : band;
  }
  const loose = /\b([2-6])0s\b/.exec(text);
  if (loose) return `${loose[1]}0s`;
  const exact = /\b(1[89]|[2-6][0-9])\s*(?:years old|yo|yrs)?\b/.exec(text);
  if (exact) {
    const years = Number(exact[1]);
    if (years >= 18 && years <= 69) return `${years}-year-old`;
  }
  return null;
}

/**
 * The same words the cast slate reads a role's gender from. An actor the buyer
 * typed in by hand has no gender column, and inventing one for them would be
 * worse than leaving hair and build unsexed.
 */
export function inferGenderFromText(text: string): CastGender | null {
  const hay = text.toLowerCase();
  const woman = /\b(woman|female|girl|lady|wife|mother|sister|daughter|she|her|luna|omega|bride|maid)\b/.test(hay);
  const man = /\b(man|male|boy|gentleman|husband|father|brother|son|he|him|his|alpha|don|prince)\b/.test(hay);
  if (woman && !man) return "woman";
  if (man && !woman) return "man";
  return null;
}

/** Both lists read on anyone, so an unsexed role still gets hair and a build. */
function poolFor(table: Record<CastGender, ReadonlyArray<string>>, gender: CastGender | null): ReadonlyArray<string> {
  return gender ? table[gender] : [...table.man, ...table.woman];
}

/** Which colours and irises a heritage actually carries, for callers that test plausibility. */
export function heritagePalettes(notes: string): { hair: ReadonlyArray<string>; eyes: ReadonlyArray<string> } | null {
  const hit = HERITAGE.find((row) => row.notes === notes);
  return hit ? { hair: hit.hair, eyes: hit.eyes } : null;
}

/** Hair goes grey from the forties on, whatever the heritage. */
function greys(age: string): boolean {
  return /\b(forties|fifties|sixties|around fifty|4[0-9]|5[0-9]|6[0-9])\b/.test(age);
}

/** A distinct, repeatable physical identity for one generated character. */
export function castAppearance(input: {
  name: string;
  gender: CastGender | null;
  note?: string | null;
}): CastAppearance {
  const name = input.name.trim().toLowerCase();
  const gender = input.gender;
  const age = ageFromNote(input.note) ?? pick(name, "age", AGE_BANDS);
  const heritage = pick(name, "heritage", HERITAGE);
  const colours = greys(age) ? [...heritage.hair, ...GREYING] : heritage.hair;
  return {
    age_look: gender ? `${age} ${gender}` : `${age} adult`,
    ethnicity_notes: heritage.notes,
    hair: `${pick(name, "colour", colours)} ${pick(name, "cut", poolFor(HAIR_CUT, gender))}`,
    face: `${pick(name, "shape", FACE_SHAPE)}, ${pick(name, "eyes", heritage.eyes)}, ${pick(name, "mark", MARK)}`,
    body: pick(name, "build", poolFor(BUILD, gender)),
  };
}

/**
 * What the buyer typed always wins. They may have described the face on
 * purpose, and a cast trait that contradicts their own words makes the model
 * average the two into a third person. Only the traits their text is silent
 * about get filled in.
 */
const DESCRIBED: Record<keyof CastAppearance, RegExp> = {
  age_look: /\b(age[ds]?|young|old(?:er)?|teen|twenties|thirties|forties|fifties|middle-aged|\d{2}s?\b)/i,
  ethnicity_notes:
    /\b(skin|complexion|heritage|undertone|asian|african|european|latin|latina|latino|hispanic|arab|middle eastern|nordic|slavic|caribbean|olive|pale|tan|brown-skinned|dark-skinned|fair-skinned)\b/i,
  hair: /\b(hair|bald|shaved head|braid(?:s|ed)?|ponytail|buzz(?:ed)?|blond(?:e)?|brunette|redhead|ginger|greying|grey-haired)\b/i,
  face: /\b(face|jaw|jawline|cheek(?:bones?)?|nose|chin|brow|eyes?|freckles?|scar|mole|dimple)\b/i,
  body: /\b(tall|short|slim|slender|athletic|heavy(?:-set)?|build|stocky|petite|lean|curv(?:y|ed)|broad|wiry|frame)\b/i,
};

export function fillAppearance(description: string, cast: CastAppearance): CastAppearance {
  const text = description.trim();
  const keys = Object.keys(DESCRIBED) as Array<keyof CastAppearance>;
  const filled = {} as CastAppearance;
  for (const key of keys) {
    filled[key] = text && DESCRIBED[key].test(text) ? "" : cast[key];
  }
  return filled;
}
