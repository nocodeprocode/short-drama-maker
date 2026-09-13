import { describe, expect, it } from "vitest";
import {
  applyDoorSide,
  formatPropLock,
  inferDoorSide,
  inferPropIdentity,
  inferPropLock,
  inferPropState,
  lockDoorSide,
  PHYSICS_RULES,
  physicsProblems,
  propStateLies,
  stripSpentEntrance,
  stripUnarrivedFromStaging,
} from "./physics.ts";

describe("PHYSICS_RULES", () => {
  it("is genre-agnostic and names door, state stills, and entrances", () => {
    expect(PHYSICS_RULES).toMatch(/PHYSICS LOCK/);
    expect(PHYSICS_RULES).toMatch(/camera-right/);
    expect(PHYSICS_RULES).toMatch(/broken still/);
    expect(PHYSICS_RULES).toMatch(/has not walked through/);
    expect(PHYSICS_RULES).not.toMatch(/\b(nude|naked|undress|celebrity|cocaine|actor)\b/i);
    expect(PHYSICS_RULES).not.toMatch(/Mara|Cole|Juno|wolf/i);
  });
});

describe("door lock", () => {
  it("keeps the first door side and rewrites a later flip", () => {
    expect(inferDoorSide("OREN comes in through the camera-left door")).toBe("camera-left");
    expect(lockDoorSide(["desk lamp", "OREN through the camera-right door"])).toBe("camera-right");
    expect(lockDoorSide(["no door mentioned"])).toBe("camera-right");
    expect(applyDoorSide("the camera-left door stays open", "camera-right")).toMatch(/camera-right door/);
  });
});

describe("prop states", () => {
  it("does not lock an opened envelope as a closed letter", () => {
    const opened = "NYLA: I opened your envelope.\nNYLA: The wax was cracked before I touched it.";
    expect(inferPropIdentity(opened)).toMatch(/envelope/);
    expect(inferPropState(opened)).toBe("broken");
    expect(inferPropLock(opened)).toMatch(/STATE broken/);
    expect(inferPropLock(opened)).not.toMatch(/intact wax|STATE sealed/);
    expect(inferPropLock("the letter on the table")).toMatch(/letter/);
    // A logline that says "parcel" once must not outvote a script that says
    // "envelope" every take — that is the cardboard-box render.
    expect(
      inferPropIdentity(
        "the parcel she opened was a mate claim. NYLA: I opened your envelope. NYLA: Keep your envelope, it has red wax.",
      ),
    ).toBe("black envelope with red wax");
    expect(inferPropIdentity("she signs for the parcel and leaves the package")).toBe("brown parcel");
    // A folder someone carries and a contract someone signs are scenery; the
    // hero object is the one the state verbs attach to.
    expect(
      inferPropIdentity(
        [
          "NYLA: I opened your envelope — it was already cracked, so don't start.",
          "OREN: (folder in hand) The balance cleared at midnight.",
          "ROMAN: Sign the contract.",
          "NYLA: Keep your envelope.",
        ].join("\n"),
      ),
    ).toMatch(/envelope/);
    expect(inferPropLock("closed wolf-dog carrier")).toMatch(/carrier/);
  });

  it("flags a sealed still against a spoken broken seal", () => {
    expect(propStateLies("NYLA: I opened your envelope.", formatPropLock("black envelope with red wax", "sealed"))).toBe(true);
    expect(propStateLies("NYLA: I opened your envelope.", formatPropLock("black envelope with red wax", "broken"))).toBe(false);
  });
});

describe("presence physics", () => {
  it("strips a name who has not entered and flags a door flip", () => {
    expect(stripUnarrivedFromStaging("NYLA at the desk. OREN one step back.", ["NYLA", "ROMAN"], ["Nyla", "Roman", "Oren"])).not.toMatch(/OREN/);
    expect(stripSpentEntrance("Both at the desk. OREN is not in the room at the start. The locked door stays camera-right. ENTRANCE is a full-page shot of OREN coming through that camera-right door.")).not.toMatch(/not in the room|ENTRANCE is a full-page/);
    const hits = physicsProblems(
      [
        {
          script: "NYLA: I opened it.",
          staging: "NYLA camera-left; ROMAN camera-right; door camera-right",
          prop: formatPropLock("black envelope with red wax", "broken"),
          present: ["NYLA", "ROMAN"],
          enters: [],
          door_side: "camera-right",
        },
        {
          script: "NYLA: I opened your envelope.\nOREN: Boss.",
          staging: "OREN already inside; door camera-left",
          prop: formatPropLock("black envelope with red wax", "sealed"),
          present: ["NYLA", "ROMAN", "OREN"],
          enters: [],
          door_side: "camera-left",
        },
      ],
      ["Nyla", "Roman", "Oren"],
    );
    expect(hits.some((hit) => hit.kind === "door_flip")).toBe(true);
    expect(hits.some((hit) => hit.kind === "prop_lie")).toBe(true);
    expect(hits.some((hit) => hit.kind === "ghost")).toBe(true);
  });
});
