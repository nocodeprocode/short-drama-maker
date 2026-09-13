import { cueRows, cueText } from "./continuity.ts";

/**
 * Genre-agnostic room and object physics. Writer, repair, prompts, and lint
 * share this clause so a door cannot jump sides and a broken seal cannot
 * render as intact.
 */
export const PHYSICS_RULES = `PHYSICS LOCK. The room does not move. The object does not lie.
- Lock the door, window, desk, and lamp to one screen side in take 1. Repeat that side in every later take. If the door is camera-right, it stays camera-right. It never jumps.
- The hero object is one object with states. Generate a still for each state (sealed, broken, open, closed). When a line says the seal is broken, the picture is the broken still — never the sealed one.
- A person who has not walked through the locked door is not in the room. They cannot already be standing inside. An entrance is Shot 1 of that person coming through the locked door.
- Same walls, same ground, same key light. Nothing teleports.`;

export type ScreenSide = "camera-left" | "camera-right";
export type PropState = "sealed" | "broken" | "open" | "closed" | "face-down";

export const DEFAULT_DOOR_SIDE: ScreenSide = "camera-right";

const OPPOSITE: Record<ScreenSide, ScreenSide> = {
  "camera-left": "camera-right",
  "camera-right": "camera-left",
};

export type PhysicsTake = {
  script?: string | null;
  staging?: string | null;
  prop?: string | null;
  present?: readonly string[] | null;
  enters?: readonly string[] | null;
  door_side?: ScreenSide | null;
};

export type PhysicsHit = {
  kind: "door_flip" | "prop_lie" | "ghost";
  detail: string;
};

function fold(name: string): string {
  return name.trim().toLowerCase().split(/\s+/)[0] ?? "";
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inferDoorSide(text?: string | null): ScreenSide | null {
  const blob = text ?? "";
  const right = /door[^.\n]{0,48}camera-right|camera-right[^.\n]{0,48}door/i.test(blob);
  const left = /door[^.\n]{0,48}camera-left|camera-left[^.\n]{0,48}door/i.test(blob);
  if (right && !left) return "camera-right";
  if (left && !right) return "camera-left";
  return null;
}

/** First stated door side wins. Indoor default is camera-right so the room cannot drift. */
export function lockDoorSide(texts: readonly (string | null | undefined)[]): ScreenSide {
  for (const text of texts) {
    const side = inferDoorSide(text);
    if (side) return side;
  }
  return DEFAULT_DOOR_SIDE;
}

export function applyDoorSide(text: string, side: ScreenSide): string {
  const other = OPPOSITE[side];
  return text.replace(new RegExp(`(door(?:way)?)([^\\n.]{0,40})${other}`, "gi"), `$1$2${side}`).replace(
    new RegExp(`${other}([^\\n.]{0,40}door(?:way)?)`, "gi"),
    `${side}$1`,
  );
}

export function doorSidesIn(text?: string | null): ScreenSide[] {
  const found: ScreenSide[] = [];
  const side = inferDoorSide(text);
  if (side) found.push(side);
  return found;
}

/**
 * Which object the scene is actually about.
 *
 * Fixed precedence loses to the bible's vocabulary: a logline that says
 * "parcel" once outvoted a script that says "envelope" in every take, and the
 * model rendered a cardboard delivery box next to the wax-sealed envelope. The
 * object named most often in the words wins; specificity only breaks a tie.
 */
const PROP_CANDIDATES: Array<{ id: string; pattern: RegExp }> = [
  { id: "closed pet carrier", pattern: /\b(carrier|pup|puppy|wolf-?dog)\b/g },
  { id: "face-down phone", pattern: /\bphone\b/g },
  { id: "closed contract folder", pattern: /\b(contract|nda|folder)\b/g },
  { id: "envelope", pattern: /\benvelopes?\b/g },
  { id: "brown parcel", pattern: /\b(parcel|package|delivery box)\b/g },
  { id: "unlabeled letter", pattern: /\b(letter|paper|note)\b/g },
];

/** The hero object is the one with states — a folder someone carries is scenery. */
const STATE_WORDS = /\b(open(?:ed)?|crack(?:ed)?|broken|unsealed|seal(?:ed)?|wax|inside|closed|face[- ]down)\b/;

export function inferPropIdentity(text?: string | null): string {
  const blob = (text ?? "").toLowerCase();
  const lines = blob.split(/\n|(?<=[.?!])\s+/);
  let best: { id: string; score: number; rank: number } | null = null;
  for (const [rank, candidate] of PROP_CANDIDATES.entries()) {
    candidate.pattern.lastIndex = 0;
    const count = (blob.match(candidate.pattern) ?? []).length;
    if (!count) continue;
    const stateful = lines.filter((line) => {
      candidate.pattern.lastIndex = 0;
      return candidate.pattern.test(line) && STATE_WORDS.test(line);
    }).length;
    const score = count + stateful * 3;
    if (!best || score > best.score || (score === best.score && rank < best.rank)) {
      best = { id: candidate.id, score, rank };
    }
  }
  if (!best) return "unlabeled object";
  if (best.id === "envelope") {
    return /\bwax\b|\bseal\b/.test(blob) ? "black envelope with red wax" : "black envelope";
  }
  return best.id;
}

export function inferPropState(text?: string | null): PropState | null {
  const blob = (text ?? "").toLowerCase();
  if (/\b(face[- ]down)\b/.test(blob)) return "face-down";
  if (/\b(crack(?:ed)?|broken|unsealed|broke the seal|wax was crack|flap open)\b/.test(blob)) return "broken";
  if (/\b(opened|i opened|you opened|already open)\b/.test(blob)) return "broken";
  if (/\b(sealed|unopened|intact wax|wax intact|closed letter|closed envelope)\b/.test(blob)) return "sealed";
  if (/\b(unfolded|open folder|pages out)\b/.test(blob)) return "open";
  if (/\b(closed|folded)\b/.test(blob)) return "closed";
  return null;
}

function stateHint(identity: string, state: PropState): string {
  if (state === "broken") {
    return identity.includes("envelope") || identity.includes("wax")
      ? "wax cracked, flap open. Never show a whole wax seal"
      : "opened. Never show the sealed version";
  }
  if (state === "sealed") return "intact seal, flap closed. Never show it opened";
  if (state === "open") return "open, contents visible as blank paper. No readable text";
  if (state === "face-down") return "screen off, face down";
  return "closed. Same object as every other take";
}

export function formatPropLock(identity: string, state: PropState): string {
  return `the same ${identity}, STATE ${state}: ${stateHint(identity, state)}. Match the ${state}-state still.`;
}

/**
 * The prop lock is a paragraph. Repeating it inside every numbered shot cost
 * more prompt than the dialogue did, and the model reads the words it is given
 * last. State the lock once; name the object inside the shots.
 */
export function shortPropLabel(prop?: string | null): string {
  const raw = (prop ?? "").trim();
  if (!raw) return "the locked prop";
  const state = /STATE\s+(sealed|broken|open|closed|face-down)\b/i.exec(raw)?.[1]?.toLowerCase() ?? null;
  const identity = raw
    .replace(/^the same\s+/i, "")
    .replace(/,?\s*STATE\s+\S+[\s\S]*$/i, "")
    .replace(/[.]+$/, "")
    .trim();
  if (!identity) return "the locked prop";
  return state ? `the ${identity} (${state})` : `the ${identity}`;
}

export function inferPropLock(text?: string | null): string {
  const identity = inferPropIdentity(text);
  const state = inferPropState(text) ?? defaultStateFor(identity);
  return formatPropLock(identity, state);
}

export function defaultStateFor(identity: string): PropState {
  if (identity.includes("phone")) return "face-down";
  if (identity.includes("carrier")) return "closed";
  return "closed";
}

export function parsePropState(prop?: string | null): PropState | null {
  const match = /STATE\s+(sealed|broken|open|closed|face-down)\b/i.exec(prop ?? "");
  return (match?.[1]?.toLowerCase() as PropState | undefined) ?? inferPropState(prop);
}

export function spokenPropState(script?: string | null): PropState | null {
  const spoken = cueRows(script)
    .map((row) => cueText(row).replace(/\([^)]*\)/g, " "))
    .join(" ");
  return inferPropState(spoken);
}

/** Spoken "opened / broken" against a sealed/closed lock is a lie. */
export function propStateLies(script?: string | null, prop?: string | null): boolean {
  const spoken = spokenPropState(script);
  const shown = parsePropState(prop);
  if (!spoken || !shown) return false;
  const opened = spoken === "broken" || spoken === "open";
  const intact = shown === "sealed" || shown === "closed";
  return opened && intact;
}

/** Drop spent entrance sentences so the next take does not re-walk the same door. */
export function stripSpentEntrance(staging: string): string {
  return staging
    .replace(/\s*[A-Za-z][A-Za-z' .-]{0,40} is not in the room at the start\./gi, "")
    .replace(/\s*The locked door stays[^.]*\./gi, "")
    .replace(/\s*ENTRANCE is a full-page[^.]*\./gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripUnarrivedFromStaging(
  staging: string,
  legalNames: readonly string[],
  cast: readonly string[] = [],
): string {
  let out = staging;
  const legal = new Set(legalNames.map(fold).filter(Boolean));
  for (const name of ghostNamesInStaging(staging, legalNames, cast)) {
    const token = name.split(/\s+/)[0] ?? name;
    if (!token || legal.has(fold(token))) continue;
    out = out.replace(new RegExp(`\\b${escapeName(token)}\\b[^.;]*[.;]?`, "gi"), "").replace(/\s{2,}/g, " ").trim();
  }
  return out;
}

export function ghostNamesInStaging(
  staging: string | null | undefined,
  legalNames: readonly string[],
  cast: readonly string[],
): string[] {
  if (!staging) return [];
  const legal = new Set(legalNames.map(fold).filter(Boolean));
  const ghosts: string[] = [];
  for (const name of cast) {
    const token = fold(name);
    if (!token || legal.has(token)) continue;
    if (new RegExp(`\\b${escapeName(name.split(/\s+/)[0] ?? name)}\\b`, "i").test(staging)) ghosts.push(name);
  }
  return ghosts;
}

export function physicsProblems(takes: readonly PhysicsTake[], cast: readonly string[] = []): PhysicsHit[] {
  const hits: PhysicsHit[] = [];
  let lockedDoor: ScreenSide | null = null;
  const arrived: string[] = [];
  for (let index = 0; index < takes.length; index += 1) {
    const take = takes[index]!;
    const door = take.door_side ?? inferDoorSide(`${take.staging ?? ""} ${take.prop ?? ""}`);
    if (door) {
      if (lockedDoor && door !== lockedDoor) {
        hits.push({ kind: "door_flip", detail: `take ${index + 1} moves the door to ${door}` });
      }
      lockedDoor ??= door;
    }
    if (propStateLies(take.script, take.prop)) {
      hits.push({ kind: "prop_lie", detail: `take ${index + 1} says the object is open but the lock is sealed` });
    }
    const enters = (take.enters ?? []).map(fold).filter(Boolean);
    const present = (take.present ?? []).map(fold).filter(Boolean);
    const legal = index === 0 ? [...new Set([...present, ...enters, ...arrived])] : [...new Set([...arrived, ...enters])];
    for (const name of ghostNamesInStaging(take.staging, legal, cast)) {
      hits.push({ kind: "ghost", detail: `${name} is staged before they enter` });
    }
    const ledgerOn = Boolean(takes[0]?.present?.length);
    if (ledgerOn) {
      for (const name of present) {
        if (name && !arrived.includes(name) && !enters.includes(name) && index > 0) {
          hits.push({ kind: "ghost", detail: `${name} is in the room on take ${index + 1} without an entrance` });
        }
      }
    }
    for (const name of [...present, ...enters]) {
      if (name && !arrived.includes(name)) arrived.push(name);
    }
  }
  return hits;
}
