import { locationRefForScene } from "./location-ref.ts";
import { stripPowerLanguage } from "../../drama-engine/types/where.ts";

export const STILL_KIND_ORDER = ["cu", "front", "three_quarter", "profile", "full_body", "default_wardrobe"] as const;
export const FACE_KIND_ORDER = ["front", "three_quarter", "profile", "full_body"] as const;
export const CU_FACE_KIND_ORDER = ["cu", "front", "three_quarter", "profile"] as const;

export const STILL_KIND_LABELS: Record<string, string> = {
  cu: "Close-up",
  front: "Front",
  three_quarter: "Three-quarter",
  profile: "Profile",
  full_body: "Full body",
  default_wardrobe: "Everyday",
};

const LOOK_HINTS: Array<{ look: string; needles: string[] }> = [
  { look: "office", needles: ["office", "archive", "desk", "boardroom", "hospital", "clinic"] },
  { look: "formal", needles: ["gala", "ballroom", "wedding", "party", "reception", "premiere"] },
  { look: "home", needles: ["home", "apartment", "kitchen", "bedroom", "living"] },
  { look: "outdoor", needles: ["street", "plaza", "park", "rooftop", "outside", "alley", "rain", "service", "dock", "loading"] },
];

export function stillKindLabel(kind: string): string {
  if (kind.startsWith("look:")) return titleLook(kind.slice(5));
  return STILL_KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

export function titleLook(look: string): string {
  return look.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

const LOOK_PROMPTS: Record<string, string> = {
  everyday: "everyday contemporary clothes that stay on",
  office: "professional office attire, blazer and trousers",
  formal: "formal evening attire, a contemporary dress or dark suit",
  home: "at-home clothes, a knit or shirt and trousers",
  outdoor: "outdoor street clothes, a coat or jacket",
};

export function lookPrompt(look: string, wardrobe = ""): string {
  const base = LOOK_PROMPTS[look] ?? `${look} wardrobe`;
  return wardrobe.trim() ? `${base}. Base wardrobe notes: ${wardrobe}` : base;
}

export function stillAssetIds(visual: Record<string, unknown> | null | undefined): string[] {
  const refs = (visual?.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
  const wardrobe = (visual?.wardrobe_asset_ids ?? {}) as Record<string, unknown>;
  const ordered = STILL_KIND_ORDER.map((kind) => refs[kind]).filter((id): id is string => typeof id === "string" && id.length > 0);
  const rest = Object.values(refs).filter((id): id is string => typeof id === "string" && id.length > 0 && !ordered.includes(id));
  const looks = Object.values(wardrobe).filter((id): id is string => typeof id === "string" && id.length > 0 && !ordered.includes(id) && !rest.includes(id));
  return [...ordered, ...rest, ...looks];
}

export function stillRefEntries(visual: Record<string, unknown> | null | undefined): Array<{ kind: string; id: string }> {
  const refs = (visual?.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
  const wardrobe = (visual?.wardrobe_asset_ids ?? {}) as Record<string, unknown>;
  const face = STILL_KIND_ORDER.flatMap((kind) => {
    const id = refs[kind];
    return typeof id === "string" && id ? [{ kind, id }] : [];
  });
  const extraFace = Object.entries(refs).flatMap(([kind, id]) => {
    if (STILL_KIND_ORDER.includes(kind as (typeof STILL_KIND_ORDER)[number])) return [];
    return typeof id === "string" && id ? [{ kind, id }] : [];
  });
  const looks = Object.entries(wardrobe).flatMap(([look, id]) =>
    typeof id === "string" && id ? [{ kind: `look:${look}`, id }] : [],
  );
  return [...face, ...extraFace, ...looks];
}

/**
 * Every still, wardrobe, blocking, and identity-judge prompt goes through here.
 * WHERE applies to the picture, not just the video prompt: a bible that writes
 * "eyes that flash gold" would bake the glow into the locked face, and the face
 * still is declared the only legal face — so the glow would be permanent.
 */
export function appearanceDescription(input: {
  description?: string;
  age_look?: string;
  hair?: string;
  face?: string;
  body?: string;
  default_wardrobe?: string;
}): string {
  return [input.description, input.age_look, input.hair, input.face, input.body, input.default_wardrobe]
    .map((part) => stripPowerLanguage(part).trim())
    .filter((part): part is string => Boolean(part))
    .join(". ");
}

export function looksFromBible(input: {
  locations?: string[] | null;
  default_wardrobe?: string | null;
}): string[] {
  const looks = new Set<string>(["everyday"]);
  for (const location of input.locations ?? []) {
    const lower = location.toLowerCase();
    for (const hint of LOOK_HINTS) {
      if (hint.needles.some((needle) => lower.includes(needle))) looks.add(hint.look);
    }
  }
  if (input.default_wardrobe?.trim()) looks.add("everyday");
  return [...looks].slice(0, 4);
}

export function wardrobeForScene(
  wardrobeAssetIds: Record<string, string> | null | undefined,
  sceneLocation: string | null | undefined,
): string | null {
  const looks = Object.fromEntries(
    Object.entries(wardrobeAssetIds ?? {}).filter(([, id]) => Boolean(id)),
  );
  if (Object.keys(looks).length === 0) return null;
  // A look whose own name is the room ("look:alley" for "…SERVICE ALLEY…") wins.
  const matched = locationRefForScene(looks, sceneLocation);
  if (matched) return matched;
  const lower = (sceneLocation ?? "").toLowerCase();
  for (const hint of LOOK_HINTS) {
    if (hint.needles.some((needle) => lower.includes(needle)) && looks[hint.look]) return looks[hint.look]!;
  }
  return looks.everyday ?? looks.office ?? Object.values(looks)[0] ?? null;
}

export function preferredFaceId(refs: Record<string, string | undefined> | null | undefined): string | null {
  if (!refs) return null;
  for (const kind of FACE_KIND_ORDER) {
    const id = refs[kind];
    if (id) return id;
  }
  return Object.values(refs).find((id): id is string => Boolean(id)) ?? null;
}

export function preferredCuFace(
  refs: Record<string, string | undefined> | null | undefined,
): { id: string; kind: string } | null {
  if (!refs) return null;
  for (const kind of CU_FACE_KIND_ORDER) {
    const id = refs[kind];
    if (id) return { id, kind };
  }
  return null;
}

export function seedStillForCu(
  refs: Record<string, string | undefined> | null | undefined,
): { id: string; kind: string } | null {
  const cu = preferredCuFace(refs);
  if (cu) return cu;
  const body = refs?.full_body;
  if (body) return { id: body, kind: "full_body" };
  const leftover = Object.entries(refs ?? {}).find(([, id]) => Boolean(id));
  return leftover?.[1] ? { id: leftover[1], kind: leftover[0] } : null;
}
