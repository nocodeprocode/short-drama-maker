/**
 * A location is a real place, not a default interior.
 *
 * The plate generator, the vision note, and the take prompt used to assume a
 * room — island, counter, curtains, furniture — even when the bible said
 * alley, rain, pavement. That is how an outdoor scene grows blinds: the
 * model is told it is shooting an unoccupied interior, so it builds one.
 * Classify the place first, then write the lock for that kind of place.
 */

export type PlaceKind = "outdoor" | "indoor" | "threshold" | "vehicle";

const OUTDOOR =
  /\b(alley|lane|street|pavement|sidewalk|kerb|curb|rain|rooftop|roof|courtyard|plaza|dock|pier|bridge|lot|park|exterior|outside|outdoor|underpass|loading bay|fire escape|scooter|wet brick)\b/i;

const INDOOR =
  /\b(kitchen|apartment|office|lobby|penthouse|bedroom|ballroom|archive|reception|cafe|café|restaurant|clinic|hospital|suite|study|library|hallway indoors|living room|dining|bathroom|hotel desk|gala|ballroom|interior)\b/i;

const THRESHOLD =
  /\b(doorway|corridor|vestibule|entrance|threshold|porch|stoop|stairwell|landing)\b/i;

/** A car is a place we shoot, but it is not a living room. */
const VEHICLE =
  /\b(car|limo|limousine|sedan|suv|coupe|convertible|vehicle|town car|taxi)\b/i;

const VEHICLE_GROUND = /\b(garage|driveway|parking)\b/i;

const VEHICLE_CABIN = /\b(back seat|backseat|car interior|inside (the )?car)\b/i;

export function isVehicleCabin(location?: string | null): boolean {
  return VEHICLE_CABIN.test((location ?? "").trim());
}

export function placeKind(location?: string | null): PlaceKind {
  const text = (location ?? "").trim();
  if (!text) return "indoor";
  // "black car" used to fall through to indoor, so the model built a sofa
  // and a rug and parked the car on them.
  if (VEHICLE.test(text) || VEHICLE_GROUND.test(text) || VEHICLE_CABIN.test(text)) return "vehicle";
  if (OUTDOOR.test(text) && !INDOOR.test(text)) return "outdoor";
  // A hospital corridor is a corridor, not a hospital room. The more specific
  // shape wins so we do not generate a square ward and call it a corridor.
  if (THRESHOLD.test(text)) return "threshold";
  if (OUTDOOR.test(text) && INDOOR.test(text)) return "threshold";
  return "indoor";
}

export function isOutdoorPlace(location?: string | null): boolean {
  const kind = placeKind(location);
  if (kind === "outdoor") return true;
  // The cabin of a car is still not a house, but it is not the street either.
  return kind === "vehicle" && !isVehicleCabin(location);
}

/** The noun the prompt should use so the model does not "room" an alley. */
export function placeNoun(location?: string | null): string {
  switch (placeKind(location)) {
    case "outdoor":
    case "vehicle":
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
      `THIS PLACE. This is a real ${name} OUTSIDE, a finished location, not a half-built set. ` +
      `Wet pavement or real ground underfoot. Real exterior walls (brick, concrete, metal). ` +
      `A motivated night source: a caged street lamp, a practical, or light spilling through a real glazed window. ` +
      `Weather stays on the people and the ground. ` +
      `FORBIDDEN in this place: curtains, blinds, drapes, sheers, hanging fabric, a kitchen island, ` +
      `an indoor counter, a sofa, wallpaper, a studio cyclorama, a white infinity floor, ` +
      `furniture that belongs in a room, a ceiling, a half-open interior. ` +
      `A window is glass in a wall, seen from outside. It is not curtains standing in the alley.`
    );
  }
  if (kind === "vehicle") {
    if (isVehicleCabin(location)) {
      return (
        `THIS PLACE. This is the inside of a real ${name}: seats, windows, the street visible through the glass. ` +
        `Not a house. Not a living room. ` +
        `FORBIDDEN: a sofa, a rug, a ceiling of a room, wallpaper, indoor furniture.`
      );
    }
    return (
      `THIS PLACE. This is a real ${name} parked OUTSIDE on a street or driveway at night. ` +
      `Pavement under the tyres. A building or street lamp behind it. The car is empty. ` +
      `FORBIDDEN: a living room, a rug, a sofa, a wooden indoor floor, a ceiling, ` +
      `a studio backdrop, a photograph from the ceiling.`
    );
  }
  if (kind === "threshold") {
    return (
      `THIS PLACE. This is a ${name}: a long empty passage, not a square room. ` +
      `Receding walls, a vanishing point, ceiling lights in a row. ` +
      `No bed, no conference table, no office desk. ` +
      `The floor of the passage is empty. ` +
      `The camera looks down the length of the passage.`
    );
  }
  return (
    `THIS PLACE. This is a real finished ${name} INTERIOR. Four walls, a ceiling, a floor, one motivated light. ` +
    `FORBIDDEN: open sky, rain falling inside, street pavement, a parked vehicle unless seen through a window, ` +
    `a studio cyclorama, a missing wall that reads as a set.`
  );
}

/** Empty-plate lead line. Indoor plates say room; outdoor plates say exterior. */
export function placePlateLead(location?: string | null): string {
  const kind = placeKind(location);
  if (kind === "outdoor") {
    return "Photorealistic vertical 9:16 cinematic EXTERIOR still: an UNOCCUPIED real place, shot in the street, not a soundstage.";
  }
  if (kind === "vehicle") {
    if (isVehicleCabin(location)) {
      return "Photorealistic vertical 9:16 cinematic still from inside a real parked car, UNOCCUPIED, street visible through the windows.";
    }
    return "Photorealistic vertical 9:16 cinematic EXTERIOR still of a real parked car on a street at night, UNOCCUPIED, shot from the pavement like a film establishing wide. Not a room. Not a product photo from above.";
  }
  if (kind === "threshold") {
    return "Photorealistic vertical 9:16 cinematic still of a real building threshold, UNOCCUPIED, architecture only.";
  }
  return "Photorealistic vertical 9:16 interior establishing still: an UNOCCUPIED finished room.";
}

/**
 * The only legal lettering on a plate.
 *
 * Image models print dummy words — LOCATION, SAMPLE, the name of the set —
 * when we say "no text" and then also say "location plate". An elevator that
 * costs a finished floor cannot say LOCATION above the doors. If a fixture
 * normally shows a number, that number is 10. Floor 10. Symbolic, but one
 * value, never sample copy.
 */
export const PLACE_FLOOR = "10";

export function placeLettering(location?: string | null): string {
  // Do not name dummy words here. Listing LOCATION is how LOCATION ends up
  // on the lintel. Vision rejects those words after the still lands.
  const ban =
    "Never dummy labels, sample copy, lorem ipsum, or the name of the place written as a title. " +
    "No brands. No watermarks.";
  const name = (location ?? "").trim();
  if (/\b(elevator|lift)\b/i.test(name)) {
    return (
      `The only lettering in frame is the floor indicator showing ${PLACE_FLOOR}. ` +
      `A real floor, not a label of the set. Floor ${PLACE_FLOOR}. ${ban}`
    );
  }
  if (/\b(hotel|suite|motel)\b/i.test(name)) {
    return `If a door plate is visible it reads ${PLACE_FLOOR}${PLACE_FLOOR}. ${ban}`;
  }
  if (/\b(street|alley|lane)\b/i.test(name)) {
    return `If a street number is visible it reads ${PLACE_FLOOR}. ${ban}`;
  }
  if (/\b(corridor|hallway|stairwell|landing|threshold)\b/i.test(name)) {
    return (
      `If a door has a room plate it reads ${PLACE_FLOOR}. ` +
      `No other lettering. Do not invent a number over the opening. ${ban}`
    );
  }
  if (placeKind(name) === "vehicle") {
    return `If a number plate is visible it reads ${PLACE_FLOOR}. Otherwise there is no lettering. ${ban}`;
  }
  return (
    `If this place has a fixture that normally shows a number, that number is ${PLACE_FLOOR}. ` +
    `Otherwise there is no lettering. ${ban}`
  );
}

/** What the empty plate is allowed to show. */
export function placePlateDressing(location?: string | null): string {
  const kind = placeKind(location);
  // Do not name padlock or key here. "PLACE LOCK" / "locked key light"
  // already became a padlock on the floor. Vision rejects those objects.
  const emptyFloor = "The floor is empty except for furniture that belongs in this place. No extra objects.";
  if (kind === "outdoor") {
    return (
      "Architecture, weather, ground, and light only. " +
      "NO curtains, NO blinds, NO drapes, NO indoor furniture, NO ceiling, NO studio backdrop. " +
      "NO people, NO faces, NO bodies, NO silhouettes, NO mannequins, NO portraits. " +
      emptyFloor
    );
  }
  if (kind === "vehicle") {
    if (isVehicleCabin(location)) {
      return (
        "Seats, windows, and the street through the glass only. " +
        "NO house, NO sofa, NO rug, NO room ceiling, NO people, NO driver, NO passengers."
      );
    }
    return (
      "The car sits on real outdoor ground at night. Street or driveway. " +
      "Camera at street height, three-quarter or side, not from the ceiling. " +
      "NO living room, NO rug, NO sofa, NO indoor floor, NO ceiling, NO studio stand. " +
      "NO people, NO driver, NO passengers."
    );
  }
  if (kind === "threshold") {
    return (
      "Architecture and light only. A long empty passage, ceiling lights in a row, nothing on the floor. " +
      "NO furniture in the aisle, NO objects on the ground, NO people, NO faces, NO bodies, NO silhouettes. " +
      emptyFloor
    );
  }
  return (
    "Furniture, architecture and light only. A finished room with a ceiling. " +
    "NOBODY is in the room: no people, no faces, no bodies, no silhouettes, no figures with their back to camera, no reflections of people, no mannequins, no portraits or photographs of people on the walls. " +
    emptyFloor
  );
}

/** Retry copy when the first plate had a person in it — still the same kind of place. */
export function placePlateRetry(location?: string | null, physical?: string | null): string {
  const facts = (physical ?? location ?? "this place").trim();
  const kind = placeKind(location);
  if (kind === "outdoor") {
    return (
      `Unoccupied exterior, night location photography: ${facts}. ` +
      `Vacant street or alley, nobody present. Wet ground, real masonry, one street lamp or window spill. ` +
      `No curtains, no blinds, no indoor furniture, no studio floor.`
    );
  }
  if (kind === "vehicle") {
    if (isVehicleCabin(location)) {
      return `Unoccupied car interior: ${facts}. Seats and windows only. Street through the glass. No house furniture.`;
    }
    return (
      `Unoccupied car on a real street at night: ${facts}. ` +
      `Parked on pavement, shot from the street. Empty. No living room, no rug, no ceiling.`
    );
  }
  if (kind === "threshold") {
    return (
      `Unoccupied passage: ${facts}. Long empty corridor, nothing on the floor. ` +
      `Ceiling lights in a row. Vacant, nobody present.`
    );
  }
  return (
    `Unoccupied interior, architectural photography of a finished room: ${facts}. ` +
    `Vacant, nobody present. Ceiling, walls, floor, one motivated light. Not a set missing a wall.`
  );
}

/** Vision geometry: ask for the real anchors of this place, not a kitchen island. */
export function placeGeometryRubric(location?: string | null): string {
  const kind = placeKind(location);
  if (kind === "outdoor") {
    return (
      "geometry is one sentence of the real exterior: the wall they use, the ground material, " +
      "where the light comes from (street lamp or window), where the opening / alley mouth is, " +
      "and that there are no indoor curtains or furniture in the street"
    );
  }
  if (kind === "vehicle") {
    return (
      "geometry is one sentence of the real vehicle place: the car, the pavement or cabin, " +
      "what is behind or through the glass, the light, and that this is not a furnished room"
    );
  }
  return (
    "geometry is one sentence floor plan: the main work surface, its height and where it sits, " +
    "which side the window is on, which side the shelves or wall units are on, the floor material"
  );
}

/** How a third person arrives in this place. */
export function placeEntrance(location?: string | null): string {
  if (isOutdoorPlace(location)) {
    return "enters from the far end of the place (the street or alley mouth). ENTRANCE CUT: full-page chest-up or cowboy of the person arriving, key light on their face; do not stay on a seated cheek looking toward them";
  }
  return "enters through the door. ENTRANCE CUT: full-page chest-up or cowboy of the person in the doorway, key light on their face; do not stay on a seated cheek looking at the door";
}

export function placeExit(location?: string | null): string {
  if (isOutdoorPlace(location)) {
    return "turns and walks out toward the street end; the remaining face reacts to the empty opening";
  }
  return "turns and walks out through the door; the remaining face reacts to the empty doorway";
}

/**
 * Extra stills of the same empty set, derived from the master plate.
 *
 * One establishing still is a three-quarter into the place. Later cuts face
 * the other walls, so each wall (and a plan) has to exist as its own empty
 * still or the next generation invents new art and furniture.
 */
export type RoomAngle = { angle: string; prompt: string };

const ROOM_PACK_HOLD =
  "Same walls, same furniture at the same size, same wall art, same key light and colour. " +
  "Same kind of place as the plate — do not turn an exterior into a room or a room into a street. " +
  "EMPTY: no people, no faces, no silhouettes, no reflections of people. Cinematic 9:16 still.";

const ROOM_ANGLE_LABELS: Record<string, string> = {
  facing: "Facing",
  opposite: "Opposite",
  left: "Left",
  right: "Right",
  overhead: "Overhead",
  reverse: "Opposite",
  far: "Far",
  rear: "Rear",
  front: "Front",
};

export function roomAngleLabel(angle: string): string {
  return ROOM_ANGLE_LABELS[angle] ?? angle.replaceAll("_", " ");
}

function overheadPrompt(kind: PlaceKind): string {
  if (kind === "outdoor" || kind === "vehicle") {
    return `the same empty place from directly above, a straight-down plan. Ground and objects stay in the same positions. ${ROOM_PACK_HOLD}`;
  }
  return (
    `the same empty place from directly above, a straight-down plan. ` +
    `Furniture stays in the same positions. Wall art readable as edge strips along the walls. ${ROOM_PACK_HOLD}`
  );
}

/** The five (or fewer) views that lock a place after the master plate. */
export function roomAnglesFor(location?: string | null): RoomAngle[] {
  const kind = placeKind(location);
  if (kind === "vehicle" && isVehicleCabin(location)) {
    return [
      {
        angle: "reverse",
        prompt: `the same empty cabin seen from the opposite seats, looking toward the front seats. ${ROOM_PACK_HOLD}`,
      },
      {
        angle: "left",
        prompt: `the same empty cabin through the left window, same seats and dash. ${ROOM_PACK_HOLD}`,
      },
      {
        angle: "right",
        prompt: `the same empty cabin through the right window, same seats and dash. ${ROOM_PACK_HOLD}`,
      },
    ];
  }
  if (kind === "vehicle") {
    return [
      { angle: "rear", prompt: `the same empty parked car from the rear, same body, same street, same light. ${ROOM_PACK_HOLD}` },
      { angle: "left", prompt: `the same empty parked car from the left side, same body, same street. ${ROOM_PACK_HOLD}` },
      { angle: "right", prompt: `the same empty parked car from the right side, same body, same street. ${ROOM_PACK_HOLD}` },
      { angle: "front", prompt: `the same empty parked car from the front, same body, same street. ${ROOM_PACK_HOLD}` },
      { angle: "overhead", prompt: overheadPrompt(kind) },
    ];
  }
  if (kind === "outdoor") {
    return [
      { angle: "opposite", prompt: `the same empty exterior from the opposite direction, camera turned 180 degrees. ${ROOM_PACK_HOLD}` },
      { angle: "left", prompt: `the same empty exterior, camera turned 90 degrees left. ${ROOM_PACK_HOLD}` },
      { angle: "right", prompt: `the same empty exterior, camera turned 90 degrees right. ${ROOM_PACK_HOLD}` },
      { angle: "far", prompt: `the same empty exterior from farther back, showing what stood behind the first camera. ${ROOM_PACK_HOLD}` },
      { angle: "overhead", prompt: overheadPrompt(kind) },
    ];
  }
  if (kind === "threshold") {
    return [
      { angle: "facing", prompt: `the same empty passage, looking straight at the far-end wall. ${ROOM_PACK_HOLD}` },
      { angle: "reverse", prompt: `the same empty passage from the opposite end, camera turned 180 degrees. ${ROOM_PACK_HOLD}` },
      { angle: "left", prompt: `the same empty passage, camera turned to the left wall, straight-on. ${ROOM_PACK_HOLD}` },
      { angle: "right", prompt: `the same empty passage, camera turned to the right wall, straight-on. ${ROOM_PACK_HOLD}` },
      { angle: "overhead", prompt: overheadPrompt(kind) },
    ];
  }
  return [
    {
      angle: "facing",
      prompt: `the same empty room, looking straight at the wall that faced the first camera. Not a three-quarter. ${ROOM_PACK_HOLD}`,
    },
    { angle: "opposite", prompt: `the same empty room, looking straight at the opposite wall. ${ROOM_PACK_HOLD}` },
    { angle: "left", prompt: `the same empty room, looking straight at the left wall. ${ROOM_PACK_HOLD}` },
    { angle: "right", prompt: `the same empty room, looking straight at the right wall. ${ROOM_PACK_HOLD}` },
    { angle: "overhead", prompt: overheadPrompt(kind) },
  ];
}
