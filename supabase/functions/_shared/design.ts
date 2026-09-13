import type { Service } from "./productions.ts";
import { buildDesignSlate, expandPlaceName, propKindFor, propsFromArchetype, sameDesignThing } from "./design-slate.ts";
import { signedGetUrl } from "./sign.ts";

export type DesignStatus = "planned" | "building" | "ready" | "failed";

export type LocationRow = {
  id: string;
  series_id: string;
  name: string;
  note: string;
  origin: string;
  position: number;
  plate_asset_id: string | null;
  lighting_lock: string | null;
  status: string;
  locked: boolean;
  error: string | null;
};

export type PropRow = {
  id: string;
  series_id: string;
  name: string;
  note: string;
  origin: string;
  position: number;
  still_asset_id: string | null;
  kind: string | null;
  state: string | null;
  status: string;
  locked: boolean;
  error: string | null;
  cast_slot_id: string | null;
};

function asStatus(value: unknown): DesignStatus {
  return value === "building" || value === "ready" || value === "failed" ? value : "planned";
}

/** Extra angles of the same empty set, derived from the current plate. */
export type LocationAngle = { angle: string; url: string; plate_id?: string };

export function presentLocation(
  row: LocationRow,
  extras: { plate_url?: string | null; angles?: LocationAngle[] } = {},
) {
  return {
    id: row.id,
    series_id: row.series_id,
    name: row.name,
    note: row.note ?? "",
    origin: row.origin === "story" || row.origin === "buyer" ? row.origin : "slate",
    position: row.position ?? 0,
    plate_url: extras.plate_url ?? null,
    lighting_lock: row.lighting_lock ?? null,
    /** Every wall plus overhead of the same empty set, built with the plate. */
    angles: extras.angles ?? [],
    status: asStatus(row.status),
    locked: Boolean(row.locked),
    error: row.error ?? null,
  };
}

export function presentProp(row: PropRow, extras: { still_url?: string | null; angles?: LocationAngle[] } = {}) {
  return {
    id: row.id,
    series_id: row.series_id,
    name: row.name,
    note: row.note ?? "",
    origin:
      row.origin === "story" || row.origin === "buyer" || row.origin === "cast_device" ? row.origin : "slate",
    position: row.position ?? 0,
    still_url: extras.still_url ?? null,
    kind: row.kind ?? propKindFor(row.name),
    state: row.state ?? null,
    /** Extra faces of the same object when it has a back or an open state. */
    angles: extras.angles ?? [],
    status: asStatus(row.status),
    locked: Boolean(row.locked),
    error: row.error ?? null,
    cast_slot_id: row.cast_slot_id ?? null,
  };
}

export function normalizeDesignName(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function signOne(path: string | null | undefined): Promise<string | null> {
  const base = Deno.env.get("MEDIA_STORE_URL")?.trim();
  const secret = Deno.env.get("MEDIA_SIGNING_SECRET")?.trim();
  if (!base || !secret || !path) return null;
  try {
    return await signedGetUrl(base, secret, path, 60 * 30);
  } catch {
    return null;
  }
}

/**
 * Signed URLs for every plate and still on this show, plus the room angles the
 * shoot derived from each plate, keyed by the location name they belong to.
 */
export async function signDesignAssets(
  supabase: Service,
  seriesId: string,
  assetIds: string[],
): Promise<{
  byId: Map<string, string>;
  anglesByLocation: Map<string, LocationAngle[]>;
  anglesByStill: Map<string, LocationAngle[]>;
}> {
  const byId = new Map<string, string>();
  const anglesByLocation = new Map<string, LocationAngle[]>();
  const anglesByStill = new Map<string, LocationAngle[]>();
  const wanted = assetIds.filter(Boolean);

  const [{ data: plates }, { data: roomAngles }, { data: objectAngles }] = await Promise.all([
    wanted.length
      ? supabase.from("assets").select("id, storage_path").in("id", wanted)
      : Promise.resolve({ data: [] as Array<{ id: string; storage_path: string }> }),
    supabase
      .from("assets")
      .select("id, storage_path, metadata")
      .eq("series_id", seriesId)
      .eq("kind", "character_reference")
      .contains("metadata", { kind: "room_angle" }),
    supabase
      .from("assets")
      .select("id, storage_path, metadata")
      .eq("series_id", seriesId)
      .eq("kind", "character_reference")
      .contains("metadata", { kind: "object_angle" }),
  ]);

  for (const row of plates ?? []) {
    const url = await signOne(row.storage_path);
    if (url) byId.set(String(row.id), url);
  }
  for (const row of roomAngles ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const location = String(meta.location ?? "").trim();
    const angle = String(meta.angle ?? "").trim();
    const plateId = String(meta.plate_id ?? "").trim();
    if (!location || !angle) continue;
    const url = await signOne(row.storage_path);
    if (!url) continue;
    const list = anglesByLocation.get(location) ?? [];
    list.push({ angle, url, plate_id: plateId || undefined });
    anglesByLocation.set(location, list);
  }
  for (const row of objectAngles ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const stillId = String(meta.still_id ?? "").trim();
    const angle = String(meta.angle ?? "").trim();
    if (!stillId || !angle) continue;
    const url = await signOne(row.storage_path);
    if (!url) continue;
    const list = anglesByStill.get(stillId) ?? [];
    list.push({ angle, url });
    anglesByStill.set(stillId, list);
  }
  return { byId, anglesByLocation, anglesByStill };
}

/**
 * Makes sure a show has a design slate. Safe to run on every design-tab open:
 * rows the buyer typed stay, a plate that has already been shot is never
 * rewritten, and only missing names are inserted.
 *
 * Once the story exists its own locations win, because those are the strings the
 * scene matcher reads. Before then the slate comes from the brief, so places and
 * objects can be approved on an unpaid draft.
 */
export async function ensureDesignSlate(
  supabase: Service,
  series: {
    id: string;
    title?: string | null;
    description?: string | null;
    story_bible?: Record<string, unknown> | null;
    location_refs?: Record<string, unknown> | null;
  },
) {
  const [{ data: locationRows }, { data: propRows }, { data: castRows }] = await Promise.all([
    supabase.from("series_locations").select("*").eq("series_id", series.id).order("position"),
    supabase.from("series_props").select("*").eq("series_id", series.id).order("position"),
    supabase.from("series_cast").select("id, archetype, castable").eq("series_id", series.id),
  ]);
  const locations = (locationRows ?? []) as LocationRow[];
  const props = (propRows ?? []) as PropRow[];
  const now = new Date().toISOString();

  // A leftover "board" row is a film slate. Rename it before anything generates.
  for (const row of locations) {
    if (row.locked) continue;
    const expanded = expandPlaceName(row.name);
    if (expanded === row.name) continue;
    const taken = locations.some(
      (other) => other.id !== row.id && other.name.trim().toLowerCase() === expanded.toLowerCase(),
    );
    if (taken) continue;
    await supabase.from("series_locations").update({ name: expanded, updated_at: now }).eq("id", row.id);
    row.name = expanded;
  }

  const deviceSlots = (castRows ?? []).filter((row) => row.castable === false && row.archetype);
  const slate = buildDesignSlate({
    title: series.title ?? "",
    idea: series.description ?? "",
    deviceArchetypes: deviceSlots.map((row) => String(row.archetype)),
  });

  const takenLocations = new Set(locations.map((row) => row.name.trim().toLowerCase()));
  const takenProps = new Set(props.map((row) => row.name.trim().toLowerCase()));
  const refs = (series.location_refs ?? {}) as Record<string, unknown>;

  // The story's own rooms, already plated by the shoot.
  const bible = (series.story_bible ?? null) as { locations?: unknown } | null;
  const storyLocations = Array.isArray(bible?.locations)
    ? (bible?.locations as unknown[]).map((row) => String(row ?? "").trim()).filter(Boolean)
    : [];

  let position = locations.length;
  const insertLocation = async (name: string, origin: "slate" | "story", note: string) => {
    const key = name.trim().toLowerCase();
    if (!key || takenLocations.has(key)) return;
    const plateId = typeof refs[name] === "string" ? String(refs[name]) : null;
    await supabase.from("series_locations").insert({
      series_id: series.id,
      name,
      note,
      origin,
      position: position++,
      plate_asset_id: plateId,
      status: plateId ? "ready" : "planned",
      locked: Boolean(plateId),
      updated_at: now,
    });
    takenLocations.add(key);
  };

  for (const name of storyLocations) {
    await insertLocation(name, "story", "Written by the story. The shoot uses this exact name.");
  }
  // A draft with no story yet still gets somewhere to shoot.
  if (!storyLocations.length) {
    for (const row of slate.locations) await insertLocation(row.name, "slate", row.note);
  }

  // Which objects came out of a cast slot we refused to cast, and from which.
  const fromCastSlot = new Map<string, string>();
  for (const slot of deviceSlots) {
    for (const name of propsFromArchetype(String(slot.archetype))) {
      fromCastSlot.set(name.trim().toLowerCase(), String(slot.id));
    }
  }

  let propPosition = props.length;
  for (const row of slate.props) {
    const key = row.name.trim().toLowerCase();
    if (!key || takenProps.has(key)) continue;
    const slotId = fromCastSlot.get(key) ?? null;
    await supabase.from("series_props").insert({
      series_id: series.id,
      name: row.name,
      note: row.note,
      origin: slotId ? "cast_device" : "slate",
      position: propPosition++,
      kind: propKindFor(row.name),
      status: "planned",
      cast_slot_id: slotId,
      updated_at: now,
    });
    takenProps.add(key);
  }

  await dropDuplicateProps(supabase, series.id);
}

/**
 * Drops an object the slate listed twice at two lengths — a bare "NDA" beside
 * the plot's "leaked NDA". Never touches a row the buyer typed, a still that
 * exists, or an object already on screen.
 */
async function dropDuplicateProps(supabase: Service, seriesId: string): Promise<void> {
  const { data } = await supabase
    .from("series_props")
    .select("id, name, origin, still_asset_id, locked")
    .eq("series_id", seriesId)
    .order("position");
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    origin: string;
    still_asset_id: string | null;
    locked: boolean;
  }>;
  const doomed: string[] = [];
  for (const row of rows) {
    if (row.origin === "buyer" || row.still_asset_id || row.locked) continue;
    if (doomed.includes(row.id)) continue;
    const better = rows.find(
      (other) =>
        other.id !== row.id &&
        !doomed.includes(other.id) &&
        other.name.length > row.name.length &&
        sameDesignThing(other.name, row.name),
    );
    if (better) doomed.push(row.id);
  }
  if (doomed.length) await supabase.from("series_props").delete().in("id", doomed);
}
