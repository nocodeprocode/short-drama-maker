import { describe, expect, it } from "vitest";
import {
  isOutdoorPlace,
  placeEntrance,
  placeKind,
  placeLockClause,
  placeNoun,
  placePlateLead,
  placePlateRetry,
} from "./place.ts";

describe("place", () => {
  it("reads an alley as outdoor and a kitchen as indoor", () => {
    expect(placeKind("Service alley — wet brick, rain, caged bulb")).toBe("outdoor");
    expect(placeKind("Estate kitchen — stone floor, island")).toBe("indoor");
    expect(placeKind("Building corridor outside the apartment")).toBe("threshold");
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
    expect(placePlateLead("Estate kitchen")).toMatch(/interior location plate/);
    expect(placePlateRetry("Service alley", "wet brick, rain")).toMatch(/exterior/);
    expect(placePlateRetry("Estate kitchen", "stone island")).toMatch(/interior/);
    expect(placeEntrance("alley")).toMatch(/alley mouth|street/);
    expect(placeEntrance("kitchen")).toMatch(/door/);
  });
});
