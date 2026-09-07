/**
 * A location is a real place, not a default interior.
 *
 * The plate generator, the vision note, and the take prompt used to assume a
 * room — island, counter, curtains, furniture — even when the bible said
 * alley, rain, pavement. That is how an outdoor scene grows blinds: the
 * model is told it is shooting an unoccupied interior, so it builds one.
 * Classify the place first, then write the lock for that kind of place.
 */

export type PlaceKind = "outdoor" | "indoor" | "threshold";

const OUTDOOR =
  /\b(alley|lane|street|pavement|sidewalk|kerb|curb|rain|rooftop|roof|courtyard|plaza|dock|pier|bridge|lot|park|exterior|outside|outdoor|underpass|loading bay|fire escape|scooter|wet brick)\b/i;

const INDOOR =
  /\b(kitchen|apartment|office|lobby|penthouse|bedroom|ballroom|archive|reception|cafe|café|restaurant|clinic|hospital|suite|study|library|hallway indoors|living room|dining|bathroom|hotel desk|gala|ballroom|interior)\b/i;

const THRESHOLD =
  /\b(doorway|corridor|vestibule|entrance|threshold|porch|stoop|stairwell|landing)\b/i;

export function placeKind(location?: string | null): PlaceKind {
  const text = (location ?? "").trim();
  if (!text) return "indoor";
  if (OUTDOOR.test(text) && !INDOOR.test(text)) return "outdoor";
  if (THRESHOLD.test(text) && !INDOOR.test(text)) return "threshold";
  if (OUTDOOR.test(text) && INDOOR.test(text)) return "threshold";
  return "indoor";
}

export function isOutdoorPlace(location?: string | null): boolean {
  return placeKind(location) === "outdoor";
}

/** The noun the prompt should use so the model does not "room" an alley. */
export function placeNoun(location?: string | null): string {
  switch (placeKind(location)) {
    case "outdoor":
      return "place";
    case "threshold":
      return "threshold";
    default:
      return "room";
  }
}

/**
 * What must exist, and what must never appear, for this place.
 * Outdoor: real weather, real masonry, motivated street light.
 * Never indoor dressing hanging in the street.
 */
export function placeLockClause(location?: string | null): string {
  const kind = placeKind(location);
  const name = (location ?? "this place").split(/\s*[—–-]\s/)[0]!.trim();
  if (kind === "outdoor") {
    return (
      `PLACE LOCK. This is a real ${name} OUTSIDE, a finished location, not a half-built set. ` +
      `Wet pavement or real ground underfoot. Real exterior walls (brick, concrete, metal). ` +
      `A motivated night source: a caged street lamp, a practical, or light spilling through a real glazed window. ` +
      `Weather stays on the people and the ground. ` +
      `FORBIDDEN in this place: curtains, blinds, drapes, sheers, hanging fabric, a kitchen island, ` +
      `an indoor counter, a sofa, wallpaper, a studio cyclorama, a white infinity floor, ` +
      `furniture that belongs in a room, a ceiling, a half-open interior. ` +
      `A window is glass in a wall, seen from outside. It is not curtains standing in the alley.`
    );
  }
  if (kind === "threshold") {
    return (
      `PLACE LOCK. This is a ${name} at the edge of a building: one real interior wall and one real exterior. ` +
      `The camera chooses a side and stays there. Do not hang living-room dressing on the street side. ` +
      `Do not open the ceiling to sky on the indoor side.`
    );
  }
  return (
    `PLACE LOCK. This is a real finished ${name} INTERIOR. Four walls, a ceiling, a floor, one motivated key. ` +
    `FORBIDDEN: open sky, rain falling inside, street pavement, a parked vehicle unless seen through a window, ` +
    `a studio cyclorama, a missing wall that reads as a set.`
  );
}

/** Empty-plate lead line. Indoor plates say room; outdoor plates say exterior. */
export function placePlateLead(location?: string | null): string {
  const kind = placeKind(location);
  if (kind === "outdoor") {
    return "Photorealistic vertical 9:16 cinematic EXTERIOR still for a film: an UNOCCUPIED real place, shot on location, not a soundstage.";
  }
  if (kind === "threshold") {
    return "Photorealistic vertical 9:16 cinematic still of a real building threshold, UNOCCUPIED, architecture only.";
  }
  return "Photorealistic vertical 9:16 interior location plate for a film: an UNOCCUPIED finished room.";
}

/** What the empty plate is allowed to show. */
export function placePlateDressing(location?: string | null): string {
  const kind = placeKind(location);
  if (kind === "outdoor") {
    return (
      "Architecture, weather, ground, and light only. " +
      "NO curtains, NO blinds, NO drapes, NO indoor furniture, NO ceiling, NO studio backdrop. " +
      "NO people, NO faces, NO bodies, NO silhouettes, NO mannequins, NO portraits."
    );
  }
  return (
    "Furniture, architecture and light only. A finished room with a ceiling. " +
    "NOBODY is in the room: no people, no faces, no bodies, no silhouettes, no figures with their back to camera, no reflections of people, no mannequins, no portraits or photographs of people on the walls."
  );
}

/** Retry copy when the first plate had a person in it — still the same kind of place. */
export function placePlateRetry(location?: string | null, physical?: string | null): string {
  const facts = (physical ?? location ?? "this place").trim();
  if (placeKind(location) === "outdoor") {
    return (
      `Unoccupied exterior, night location photography: ${facts}. ` +
      `Vacant street or alley, nobody present. Wet ground, real masonry, one street lamp or window spill. ` +
      `No curtains, no blinds, no indoor furniture, no studio floor.`
    );
  }
  return (
    `Unoccupied interior, architectural photography of a finished room: ${facts}. ` +
    `Vacant, nobody present. Ceiling, walls, floor, one key light. Not a set missing a wall.`
  );
}

/** Vision geometry: ask for the real anchors of this place, not a kitchen island. */
export function placeGeometryRubric(location?: string | null): string {
  if (placeKind(location) === "outdoor") {
    return (
      "geometry is one sentence of the real exterior: the wall they use, the ground material, " +
      "where the light comes from (street lamp or window), where the opening / alley mouth is, " +
      "and that there are no indoor curtains or furniture in the street"
    );
  }
  return (
    "geometry is one sentence floor plan: the main work surface, its height and where it sits, " +
    "which side the window is on, which side the shelves or wall units are on, the floor material"
  );
}

/** How a third person arrives in this place. */
export function placeEntrance(location?: string | null): string {
  if (placeKind(location) === "outdoor") {
    return "enters from the far end of the place (the street or alley mouth), stops one step in; the others turn their heads";
  }
  return "enters through the door in the background, stops one step inside; the others turn their heads";
}

export function placeExit(location?: string | null): string {
  if (placeKind(location) === "outdoor") {
    return "turns and walks out toward the street end; the remaining face reacts to the empty opening";
  }
  return "turns and walks out through the door; the remaining face reacts to the empty doorway";
}
