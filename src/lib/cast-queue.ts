import type { CastSlot } from "./api.ts";

type QueueSlot = Pick<CastSlot, "id" | "actor_status">;

/**
 * Where each unfinished part sits in the show's single face queue. Faces are
 * built one part at a time per series, so whatever is running holds first place
 * regardless of its slate position and the parts behind it can say how many are
 * actually ahead.
 */
export function queuePlaces(people: QueueSlot[]): Map<string, number> {
  const running = people.filter((slot) => slot.actor_status === "running");
  const waiting = people.filter((slot) => slot.actor_status === "queued");
  const places = new Map<string, number>();
  [...running, ...waiting].forEach((slot, index) => places.set(slot.id, index + 1));
  return places;
}

/**
 * What a waiting part should say about itself. Every unfinished card used to read
 * "Building", which made an ordinary queue and a wedged task look identical.
 */
export function queueLabel(place: number | undefined): string {
  if (!place || place <= 1) return "Waiting its turn";
  if (place === 2) return "Next up";
  return `Waiting · ${place - 1} ahead`;
}

/** How far along a face pack is, as a percentage, or undefined before the first still. */
export function packPercent(done: number | undefined, total: number | undefined): number | undefined {
  const made = done ?? 0;
  const want = total ?? 0;
  if (!want || made <= 0) return undefined;
  return Math.round((Math.min(made, want) / want) * 100);
}
