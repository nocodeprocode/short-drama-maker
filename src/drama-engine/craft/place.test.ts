import { describe, expect, it } from "vitest";
import {
  isOutdoorPlace,
  placeEntrance,
  placeKind,
  placeLockClause,
  placeNoun,
  placeLettering,
  placePlateDressing,
  placePlateLead,
  placePlateRetry,
  roomAngleLabel,
  roomAnglesFor,
  groupByPlaceFolder,
  placeFolder,
  placeFolderLabel,
  placeMatchesQuery,
} from "./place.ts";

describe("place", () => {
  it("reads an alley as outdoor and a kitchen as indoor", () => {
    expect(placeKind("Service alley — wet brick, rain, caged bulb")).toBe("outdoor");
    expect(placeKind("Estate kitchen — stone floor, island")).toBe("indoor");
    expect(placeKind("Building corridor outside the apartment")).toBe("threshold");
    // "hospital" is indoor, but the shape of the place is the corridor.
    expect(placeKind("hospital corridor")).toBe("threshold");
    expect(placeKind("hospital")).toBe("indoor");
    expect(placeKind("black car")).toBe("vehicle");
    expect(placeKind("car back seat")).toBe("vehicle");
    expect(isOutdoorPlace("black car")).toBe(true);
    expect(isOutdoorPlace("car back seat")).toBe(false);
    expect(isOutdoorPlace("rain-soaked delivery lane under a street lamp")).toBe(true);
    expect(placeNoun("wet alley")).toBe("place");
    expect(placeNoun("kitchen")).toBe("room");
  });

  it("forbids indoor dressing on an outdoor plate and does not call an alley a room", () => {
    const lock = placeLockClause("Service alley — wet brick, rain");
    expect(lock).toMatch(/OUTSIDE/);
    expect(lock).toMatch(/curtains|blinds/i);
    expect(lock).not.toMatch(/finished room/i);
    expect(placePlateLead("Service alley")).toMatch(/EXTERIOR/);
    expect(placePlateLead("Estate kitchen")).toMatch(/interior establishing still/);
    expect(placePlateLead("Estate kitchen")).not.toMatch(/location plate/i);
    expect(placePlateRetry("Service alley", "wet brick, rain")).toMatch(/exterior/);
    expect(placePlateRetry("Estate kitchen", "stone island")).toMatch(/interior/);
    expect(placeEntrance("alley")).toMatch(/alley mouth|street/);
    expect(placeEntrance("kitchen")).toMatch(/door/);
  });

  it("puts floor 10 on an elevator and never asks the model to write dummy copy", () => {
    const elevator = placeLettering("elevator lobby");
    expect(elevator).toMatch(/floor indicator showing 10/);
    expect(elevator).toMatch(/Floor 10/);
    expect(elevator).not.toMatch(/LOCATION|SAMPLE|INSERT|PLATE|9:16/);
    expect(placeLettering("hotel suite")).toMatch(/1010/);
    expect(placeLettering("service alley")).toMatch(/street number[\s\S]*10/);
    expect(placeLettering("estate kitchen")).toMatch(/that number is 10/);
    expect(placeLettering("estate kitchen")).toMatch(/no lettering/);
  });

  it("does not tell the image model to lock or key a corridor, and keeps the floor empty", () => {
    const lock = placeLockClause("hospital corridor");
    const dressing = placePlateDressing("hospital corridor");
    expect(lock).toMatch(/empty passage/);
    expect(lock).toMatch(/floor of the passage is empty/);
    expect(lock).not.toMatch(/\b(lock|locked|padlock|key)\b/i);
    expect(dressing).toMatch(/nothing on the floor/);
    expect(dressing).not.toMatch(/\b(lock|locked|padlock|key)\b/i);
    expect(placeLettering("hospital corridor")).toMatch(/room plate it reads 10/);
    expect(placeLettering("hospital corridor")).toMatch(/Do not invent a number over the opening/);
  });

  it("puts a black car on the street, not in a living room", () => {
    expect(placePlateLead("black car")).toMatch(/EXTERIOR/);
    expect(placePlateLead("black car")).toMatch(/parked car on a street/);
    expect(placePlateLead("black car")).not.toMatch(/finished room|living room/i);
    expect(placeLockClause("black car")).toMatch(/OUTSIDE/);
    expect(placeLockClause("black car")).toMatch(/living room/);
    expect(placePlateDressing("black car")).toMatch(/outdoor ground/);
    expect(placePlateDressing("black car")).toMatch(/NO living room/);
    expect(placePlateRetry("black car", "black sedan")).toMatch(/street at night/);
    expect(placeNoun("black car")).toBe("place");
  });

  it("gives an indoor room five wall-and-plan views", () => {
    const angles = roomAnglesFor("glass office");
    expect(angles.map((row) => row.angle)).toEqual(["facing", "opposite", "left", "right", "overhead"]);
    expect(angles.every((row) => /GEOMETRY LOCK/i.test(row.prompt))).toBe(true);
    expect(angles.find((row) => row.angle === "overhead")?.prompt).toMatch(/straight-down architectural plan/i);
    expect(angles.find((row) => row.angle === "opposite")?.prompt).toMatch(/camera station.*180 degrees/i);
    expect(roomAngleLabel("opposite")).toBe("Opposite");
    expect(roomAngleLabel("overhead")).toBe("Overhead");
  });

  it("does not ask an alley or a car for four walls of a room", () => {
    const alley = roomAnglesFor("service alley");
    expect(alley.map((row) => row.angle)).toEqual(["opposite", "left", "right", "far", "overhead"]);
    expect(alley.some((row) => /empty room|four walls/i.test(row.prompt))).toBe(false);
    expect(alley.every((row) => /empty exterior|straight-down plan/i.test(row.prompt))).toBe(true);

    const car = roomAnglesFor("black car");
    expect(car.map((row) => row.angle)).toEqual(["rear", "left", "right", "front", "overhead"]);
    expect(car.some((row) => /empty room|four walls/i.test(row.prompt))).toBe(false);

    const cabin = roomAnglesFor("car back seat");
    expect(cabin.map((row) => row.angle)).toEqual(["reverse", "left", "right"]);
    expect(cabin.some((row) => row.angle === "overhead")).toBe(false);
    expect(cabin.some((row) => /house-plan|empty room/i.test(row.prompt))).toBe(false);
  });

  it("builds an elevator as a closed cab with no window", () => {
    expect(placePlateLead("elevator")).toMatch(/elevator cab/);
    expect(placePlateLead("elevator")).toMatch(/No window/);
    expect(placeLockClause("elevator")).toMatch(/FORBIDDEN: a window/);
    expect(placePlateDressing("elevator")).toMatch(/NO window/);
    expect(placePlateRetry("elevator", "passenger elevator")).toMatch(/No window/);
    expect(placePlateLead("elevator")).not.toMatch(/picture window|hotel suite/i);

    const angles = roomAnglesFor("elevator");
    expect(angles.map((row) => row.angle)).toEqual(["facing", "opposite", "left", "right", "overhead"]);
    expect(angles.every((row) => /No window/i.test(row.prompt))).toBe(true);
    expect(angles.some((row) => /closed metal doors/i.test(row.prompt))).toBe(true);
    expect(roomAngleLabel("facing", "elevator")).toBe("Doors");
    expect(roomAngleLabel("overhead", "elevator")).toBe("Ceiling");
  });

  it("files places into catalog folders and finds them by name or folder", () => {
    expect(placeFolder("glass office")).toBe("indoor");
    expect(placeFolder("service alley")).toBe("outdoor");
    expect(placeFolder("hospital corridor")).toBe("threshold");
    expect(placeFolder("black car")).toBe("vehicle");
    expect(placeFolder("elevator")).toBe("elevator");
    expect(placeFolderLabel("indoor")).toBe("Rooms");

    const folders = groupByPlaceFolder(
      ["signing table", "elevator", "gala", "black car"],
      (name) => name,
    );
    expect(folders.map((row) => row.id)).toEqual(["elevator", "indoor", "vehicle"]);
    expect(folders.find((row) => row.id === "indoor")?.items).toEqual(["signing table", "gala"]);

    expect(placeMatchesQuery("elevator", "elev")).toBe(true);
    expect(placeMatchesQuery("glass office", "rooms")).toBe(true);
    expect(placeMatchesQuery("black car", "office")).toBe(false);
    expect(placeMatchesQuery("gala", "contract", ["Claws in the Contract"])).toBe(true);
  });
});
