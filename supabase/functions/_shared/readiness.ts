import type { Service } from "./productions.ts";
import { asJob, inferSlotGender, type CastSlotRow } from "./casting.ts";
import { isStoryDevice, personName } from "./slate.ts";

/**
 * What still has to exist before a show can be shot.
 *
 * The shoot reads a face for every speaking part, a plate for every room, and a
 * still for every object the plot turns on. Anything missing here is invented
 * mid-run, which is where a scene drifts: a different penthouse in episode 4, a
 * contract that does not match the one from episode 1. So the buyer approves all
 * three first, and this is the single place that decides whether they have.
 */

export type ReadyGroup = {
  done: number;
  total: number;
  /** Names of what is still missing, for a sentence the buyer can act on. */
  missing: string[];
};

export type Readiness = {
  cast: ReadyGroup;
  places: ReadyGroup;
  objects: ReadyGroup;
  /** Parts with no name or no gender yet: a face cannot be generated for them. */
  unnamed: number;
  can_start: boolean;
  blocking: string[];
};

function group(done: number, total: number, missing: string[]): ReadyGroup {
  return { done, total, missing: missing.slice(0, 8) };
}

function sentence(count: number, one: string, many: string, names: string[]): string {
  const label = count === 1 ? one : many;
  if (!names.length) return `${count} ${label} still to do`;
  const shown = names.slice(0, 3).join(", ");
  const rest = count - Math.min(names.length, 3);
  return `${count} ${label} still to do: ${shown}${rest > 0 ? ` +${rest}` : ""}`;
}

/**
 * A speaking part counts as cast when it has a face pack with at least one
 * still. An actor row with no stills yet is still building, so it does not
 * count: starting then would shoot a character with no face.
 */
export async function seriesReadiness(
  supabase: Service,
  seriesId: string,
): Promise<Readiness> {
  const [{ data: castRows }, { data: locationRows }, { data: propRows }, { data: characterRows }] =
    await Promise.all([
      supabase.from("series_cast").select("*").eq("series_id", seriesId).order("position"),
      supabase.from("series_locations").select("id, name, plate_asset_id, locked").eq("series_id", seriesId),
      supabase.from("series_props").select("id, name, still_asset_id, locked").eq("series_id", seriesId),
      supabase.from("characters").select("id, locked").eq("series_id", seriesId),
    ]);

  const slots = ((castRows ?? []) as CastSlotRow[]).filter((row) => {
    // Story devices are objects, not people. They are approved on the design
    // sheet as objects, so they must not also be demanded as faces here.
    const job = asJob(row.job);
    return !(row.castable === false || (job && isStoryDevice(job, String(row.archetype ?? ""))));
  });

  const actorIds = [...new Set(slots.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: actorRows } = actorIds.length
    ? await supabase.from("actors").select("id, visual_reference_asset_ids").in("id", actorIds)
    : { data: [] };
  const faced = new Set(
    (actorRows ?? [])
      .filter((row) => Object.keys((row.visual_reference_asset_ids ?? {}) as Record<string, unknown>).length > 0)
      .map((row) => String(row.id)),
  );
  const lockedCharacters = new Set(
    (characterRows ?? []).filter((row) => row.locked).map((row) => String(row.id)),
  );

  let castDone = 0;
  let unnamed = 0;
  const castMissing: string[] = [];
  for (const slot of slots) {
    const shot = slot.character_id && lockedCharacters.has(String(slot.character_id));
    if (shot || (slot.actor_id && faced.has(String(slot.actor_id)))) {
      castDone += 1;
      continue;
    }
    const label = personName(slot) || String(slot.archetype ?? "").trim() || "a part";
    castMissing.push(label);
    if (!personName(slot) || !inferSlotGender(slot)) unnamed += 1;
  }

  const places = (locationRows ?? []) as Array<{ name: string; plate_asset_id: string | null }>;
  const placeMissing = places.filter((row) => !row.plate_asset_id).map((row) => row.name);
  const objects = (propRows ?? []) as Array<{ name: string; still_asset_id: string | null }>;
  const objectMissing = objects.filter((row) => !row.still_asset_id).map((row) => row.name);

  const blocking: string[] = [];
  if (castMissing.length) blocking.push(sentence(castMissing.length, "part has no face", "parts have no face", castMissing));
  if (placeMissing.length) blocking.push(sentence(placeMissing.length, "place", "places", placeMissing));
  if (objectMissing.length) blocking.push(sentence(objectMissing.length, "object", "objects", objectMissing));

  return {
    cast: group(castDone, slots.length, castMissing),
    places: group(places.length - placeMissing.length, places.length, placeMissing),
    objects: group(objects.length - objectMissing.length, objects.length, objectMissing),
    unnamed,
    can_start: blocking.length === 0,
    blocking,
  };
}
