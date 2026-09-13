import { describe, expect, it } from "vitest";
import { coverageDirection, coveragePatternFor, coverageStations, framingForRole, joinOpenFraming, listenerOf } from "./coverage.ts";

describe("dialogue coverage", () => {
  it("rotates master, reverse, pressure, and pullback so takes do not share a camera", () => {
    expect(coveragePatternFor({ takeIndex: 0 })).toBe("classic");
    expect(coveragePatternFor({ takeIndex: 1 })).toBe("reverse");
    expect(coveragePatternFor({ takeIndex: 2 })).toBe("pressure");
    expect(coveragePatternFor({ takeIndex: 3 })).toBe("pullback");
    expect(coveragePatternFor({ coverage: "single" })).toBe("reverse");
    expect(coveragePatternFor({ coverage: "cu" })).toBe("pressure");
    expect(coveragePatternFor({ coverage: "room" })).toBe("pullback");
    expect(new Set(coverageStations("classic")).size).toBe(4);
    expect(framingForRole("classic", "setup")).toBe("master");
    expect(framingForRole("classic", "peak")).toBe("ots");
    expect(framingForRole("classic", "answer")).toBe("cu");
    expect(framingForRole("reverse", "peak")).toBe("cu");
    expect(joinOpenFraming({ takeIndex: 0 })).toBe("master");
    expect(["master", "dirty"]).toContain(joinOpenFraming({ takeIndex: 1 }));
    expect(joinOpenFraming({ takeIndex: 1 })).not.toBe(framingForRole("classic", "land"));
    expect(["master", "dirty"]).toContain(joinOpenFraming({ takeIndex: 2 }));
  });

  it("writes over-the-shoulder and chest-up MCU, never stacked faces", () => {
    const ots = coverageDirection({
      framing: "ots",
      speaker: "MARA",
      listener: "COLE",
      left: "MARA",
      right: "COLE",
      upper: "COLE",
      prop: "the soaked parcel",
      beat: "voice breaks",
      mouths: `MARA's mouth speaks: "Stay."`,
      first: false,
      last: false,
      entrance: "",
      exit: "",
    });
    expect(ots).toMatch(/Over-the-shoulder/);
    expect(ots).toMatch(/behind the person on camera-right/);
    expect(ots).not.toMatch(/behind COLE/);
    expect(ots).toMatch(/two seconds minimum/);
    expect(ots).not.toMatch(/same camera position/);
    expect(ots).not.toMatch(/locked-off/);
    const stacked = coverageDirection({
      framing: "tight_two",
      speaker: "MARA",
      listener: "COLE",
      left: "MARA",
      right: "COLE",
      upper: "COLE",
      prop: "the soaked parcel",
      beat: null,
      mouths: `MARA's mouth speaks: "Stay."`,
      first: true,
      last: false,
      entrance: "",
      exit: "",
    });
    expect(stacked).toMatch(/Cowboy of|wider MCU|Chest-up MCU/i);
    expect(stacked).toMatch(/FORBIDDEN: two faces stacked/);
    expect(stacked).not.toMatch(/COLE holds/);
    expect(stacked).not.toMatch(/Both faces close to the lens, stacked/);
    expect(listenerOf("MARA", "MARA", "COLE")).toBe("COLE");
  });
});
