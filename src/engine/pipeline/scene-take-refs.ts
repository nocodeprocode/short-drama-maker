export type SceneTakeRefRole = "front" | "profile" | "wardrobe" | "room" | "prop" | "weld" | "video";

export type SceneTakeStrip = "none" | "weld" | "sheet1" | "sheet2" | "sheet3" | "location" | "wardrobe" | "sides" | "faces";

/**
 * Escalation ladder for a classifier rejection.
 *
 * The provider answers to how a still is presented as much as to the face on
 * it: the same plate is refused raw and accepted as a marked-up character
 * sheet. So the first rungs press harder on the sheet treatment, which costs
 * only colour and grain, before any rung starts removing references, which
 * costs the take its wardrobe, its room, and finally its faces.
 */
export const SCENE_TAKE_PRIVACY_STRIPS: readonly SceneTakeStrip[] = [
  "none",
  "sheet1",
  "sheet2",
  "sheet3",
  "location",
  "wardrobe",
  "sides",
  "faces",
];

/** How hard to stamp the character sheets at this rung of the ladder. */
export function sheetStrengthFor(strip: SceneTakeStrip | null | undefined): 0 | 1 | 2 | 3 {
  if (strip === "sheet1") return 1;
  if (strip === "sheet2") return 2;
  if (!strip || strip === "none" || strip === "weld") return 0;
  // Past the treatment rungs the heaviest sheet stays on: the rungs below only
  // add reference removal on top of it.
  return 3;
}

/** How far down the ladder a strip sits; -1 for rungs that are not on it. */
export function stripRank(strip: SceneTakeStrip | null | undefined): number {
  return strip ? SCENE_TAKE_PRIVACY_STRIPS.indexOf(strip) : -1;
}

/** The stronger of two strips, so a pinned shot floor never undoes an escalation. */
export function strongestStrip(a: SceneTakeStrip | null | undefined, b: SceneTakeStrip | null | undefined): SceneTakeStrip {
  if (!a) return b ?? "none";
  if (!b) return a;
  return stripRank(a) >= stripRank(b) ? a : b;
}

export type SceneTakeLock = {
  role: SceneTakeRefRole;
  name: string;
};

export type SceneTakeRef = SceneTakeLock & {
  url: string;
  assetId?: string | null;
};

export type SceneTakePersonStills = {
  name: string;
  front?: { url: string; id?: string | null } | null;
  profile?: { url: string; id?: string | null } | null;
  wardrobe?: { url: string; id?: string | null } | null;
};

export class MissingFrontStillError extends Error {
  readonly characterName: string;
  constructor(characterName: string) {
    super(`Scene take requires a locked front still for ${characterName}`);
    this.name = "MissingFrontStillError";
    this.characterName = characterName;
  }
}

export function buildSceneTakeRefs(input: {
  characters: SceneTakePersonStills[];
  locationPlate?: { url: string; id?: string | null } | null;
  /** Extra angles of the same empty set (reverse, side); the model uses them when a cut faces that way. */
  locationAngles?: Array<{ url: string; id?: string | null; angle: string }> | null;
  propPlate?: { url: string; id?: string | null; name?: string | null } | null;
  weldPlate?: { url: string; id?: string | null } | null;
}): { images: SceneTakeRef[]; video: SceneTakeRef | null; labels: SceneTakeLock[] } {
  const images: SceneTakeRef[] = [];
  const seen = new Set<string>();
  const push = (ref: SceneTakeRef) => {
    if (!ref.url || seen.has(ref.url)) return;
    seen.add(ref.url);
    images.push(ref);
  };

  for (const person of input.characters) {
    if (!person.front?.url) throw new MissingFrontStillError(person.name);
    push({
      url: person.front.url,
      assetId: person.front.id ?? null,
      role: "front",
      name: person.name,
    });
    if (person.profile?.url) {
      push({
        url: person.profile.url,
        assetId: person.profile.id ?? null,
        role: "profile",
        name: person.name,
      });
    }
    if (person.wardrobe?.url) {
      push({
        url: person.wardrobe.url,
        assetId: person.wardrobe.id ?? null,
        role: "wardrobe",
        name: person.name,
      });
    }
  }

  if (input.locationPlate?.url) {
    push({
      url: input.locationPlate.url,
      assetId: input.locationPlate.id ?? null,
      role: "room",
      name: "room",
    });
    for (const angle of input.locationAngles ?? []) {
      if (!angle.url) continue;
      push({ url: angle.url, assetId: angle.id ?? null, role: "room", name: `room-${angle.angle}` });
    }
  }
  if (input.weldPlate?.url) {
    push({
      url: input.weldPlate.url,
      assetId: input.weldPlate.id ?? null,
      role: "weld",
      name: "room",
    });
  }

  if (input.propPlate?.url) {
    push({
      url: input.propPlate.url,
      assetId: input.propPlate.id ?? null,
      role: "prop",
      name: input.propPlate.name ?? "prop",
    });
  }

  return applySceneTakeStrip({ images, video: null, labels: [] }, "none");
}

export function applySceneTakeStrip(
  pack: { images: SceneTakeRef[]; video: SceneTakeRef | null; labels: SceneTakeLock[] },
  strip: SceneTakeStrip,
): { images: SceneTakeRef[]; video: SceneTakeRef | null; labels: SceneTakeLock[] } {
  const images = pack.images.filter((row) => {
    if (strip === "none") return true;
    // The sheet rungs change how the stills look, not which ones go up.
    if (strip === "sheet1" || strip === "sheet2" || strip === "sheet3") return row.role !== "weld";
    // Last rung: the faces are the only thing a scene take cannot do without.
    if (strip === "faces") return row.role === "front";
    if (row.role === "weld") return false;
    if (strip === "location" || strip === "wardrobe" || strip === "sides") {
      if (row.role === "room") return false;
    }
    if ((strip === "wardrobe" || strip === "sides") && row.role === "wardrobe") return false;
    if (strip === "sides" && row.role === "profile") return false;
    return true;
  });
  const video = strip === "none" ? pack.video : null;
  return {
    images,
    video,
    labels: [
      ...images.map(({ role, name }) => ({ role, name })),
      ...(video ? [{ role: video.role, name: video.name }] : []),
    ],
  };
}
