import { describe, expect, it } from "vitest";
import {
  assignSceneSides,
  blockingPrompt,
  coverageForTake,
  fitCueRows,
  inferPropLock,
  packCuesIntoWindows,
  peopleInTake,
  spokenSeconds,
} from "./continuity.ts";

describe("scene speech window", () => {
  it("keeps a 15s take under a speakable line count", () => {
    const rows = [
      "RAMI: How can you do this to me after I carried that thing all night?",
      "LINA: It is none of your concern and you need to put it down.",
      "RAMI: I have a right to know what I am holding.",
      "LINA: You already know whose name is on the collar tag.",
      "RAMI: Then say it out loud in this room.",
      "LINA: I thought I was hiring a courier, not the missing heiress.",
      "RAMI: If that is true then why does the carrier settle when I walk in?",
      "LINA: Because the pups know the bloodline and so do you.",
    ];
    expect(spokenSeconds(rows)).toBeGreaterThan(15);
    const fitted = fitCueRows(rows, 15);
    expect(spokenSeconds(fitted.keep)).toBeLessThanOrEqual(15.05);
    expect(fitted.keep.length).toBeGreaterThanOrEqual(3);
    expect(fitted.overflow.length).toBeGreaterThan(0);
    const packed = packCuesIntoWindows(rows, 4, 15);
    expect(packed.every((group) => spokenSeconds(group) <= 15.05)).toBe(true);
    expect(packed.flat().length).toBeGreaterThanOrEqual(4);
  });
});

describe("screen direction", () => {
  it("locks the first two names left and right and does not flip them later", () => {
    const first = assignSceneSides(["RAMI", "LINA"]);
    expect(first).toEqual({ camera_left: "RAMI", camera_right: "LINA" });
    expect(assignSceneSides(["LINA", "RAMI"], first)).toEqual({ camera_left: "RAMI", camera_right: "LINA" });
  });

  it("names the carrier or letter as a locked prop", () => {
    expect(inferPropLock("closed wolf-dog carrier")).toMatch(/carrier/);
    expect(inferPropLock("the letter on the table")).toMatch(/letter/);
    const text = blockingPrompt({
      camera_left: "RAMI",
      camera_right: "LINA",
      prop: "the same closed pet carrier on the surface between them",
      left_gesture: "stands, hands visible",
      right_gesture: "holds the carrier handle, does not walk",
      start_from: "They have just put the carrier on the counter.",
    });
    expect(text).toMatch(/SCREEN DIRECTION LOCK/);
    expect(text).toMatch(/RAMI stays camera-left/);
    expect(text).toMatch(/do not swap sides/i);
    expect(text).not.toMatch(/Continue the blocking/i);
    expect(text).toMatch(/SET LOCK/);
  });

  it("packs camera-left first so the first face ref is the left person", () => {
    expect(
      peopleInTake({
        speakers: ["COLE", "MARA"],
        blocking: { camera_left: "MARA", camera_right: "COLE" },
      }),
    ).toEqual(["MARA", "COLE"]);
  });

  it("keeps a third speaker even when present only lists the two leads", () => {
    expect(
      peopleInTake({
        speakers: ["MARA", "COLE", "FELIX"],
        blocking: { camera_left: "MARA", camera_right: "COLE", present: ["MARA", "COLE"] },
      }),
    ).toEqual(["MARA", "COLE", "FELIX"]);
  });

  it("does not send an outdoor entrance through a door", () => {
    const text = blockingPrompt(
      {
        camera_left: "MARA",
        camera_right: "COLE",
        prop: "the soaked parcel",
        left_gesture: "kneels",
        right_gesture: "half-sits",
        enters: ["FELIX"],
      },
      "Service alley — rain, wet brick",
    );
    expect(text).toMatch(/alley mouth|street/);
    expect(text).not.toMatch(/through the door/);
    expect(text).toMatch(/Same place plate/);
  });

  it("rotates opening coverage so consecutive takes do not share a camera", () => {
    const names = ["MARA", "COLE"];
    expect(coverageForTake(0, 6, names).coverage).toBe("two_shot");
    expect(coverageForTake(1, 6, names).coverage).toBe("single");
    expect(coverageForTake(2, 6, names).coverage).toBe("room");
    expect(coverageForTake(3, 6, names, "pressing").coverage).toBe("cu");
    expect(coverageForTake(1, 6, names).pictured).toBe("COLE");
    expect(coverageForTake(0, 6, names).pictured).toBeNull();
  });
});

describe("staging", () => {
  it("puts the planner's staging into the prompt and splits two-sentence cues", async () => {
    const { splitCueSentences } = await import("./continuity.ts");
    const text = blockingPrompt({
      camera_left: "MARA",
      camera_right: "COLE",
      prop: "the same soaked parcel on the wet ground beside them",
      left_gesture: "kneels over him",
      right_gesture: "half-sits against the wall",
      staging: "COLE half-sits against the wet brick wall on the ground, soaked; MARA kneels over him, one hand on his shoulder",
      anchor: "the brick wall and the puddle line",
      upper_frame: "MARA",
    });
    expect(text).toMatch(/STAGING, locked for the whole take: COLE half-sits against the wet brick wall/);
    expect(text).toMatch(/Nobody leaves the brick wall and the puddle line/);
    expect(text).toMatch(/MARA holds the upper frame/);
    expect(text).not.toMatch(/counter/);
    expect(splitCueSentences(["MARA: (kneels) Stay with me. Look at my eyes.", "COLE: I'm fine."])).toEqual([
      "MARA: (kneels) Stay with me.",
      "MARA: Look at my eyes.",
      "COLE: I'm fine.",
    ]);
  });
});

describe("presence ledger", () => {
  it("keeps a silent character in the room and needs a scripted exit to remove them", async () => {
    const { presenceLedger, exitsIn } = await import("./continuity.ts");
    const ledger = presenceLedger([
      { speakers: ["MARA", "COLE"], script: "MARA: Breathe.\nCOLE: Leave me.", sameRoomAsPrevious: false },
      { speakers: ["FELIX", "COLE"], script: "FELIX: Boss—\nCOLE: Felix. My ride.", sameRoomAsPrevious: true },
      { speakers: ["MARA", "COLE"], script: "MARA: Your ride calls you what?\nCOLE: (turns and leaves) Late.", sameRoomAsPrevious: true },
      { speakers: ["MARA"], script: "MARA: Late.", sameRoomAsPrevious: true },
    ]);
    expect(ledger[1]!.present).toEqual(["MARA", "COLE", "FELIX"]);
    expect(ledger[1]!.enters).toEqual(["FELIX"]);
    expect(ledger[2]!.exits).toEqual(["COLE"]);
    expect(ledger[3]!.present).toEqual(["MARA", "FELIX"]);
    expect(exitsIn("COLE: (storms out) Fine.")).toEqual(["COLE"]);
    const { expectedFacesFor, sceneTakeIndexOf } = await import("./editorial.ts");
    expect(expectedFacesFor({ edit_mode: "scene_take", blocking: { present: ["MARA", "COLE", "FELIX"] } })).toBe(3);
    expect(
      sceneTakeIndexOf(
        { id: "b" },
        [
          { id: "a", edit_mode: "scene_take" },
          { id: "skip", edit_mode: "locked_take" },
          { id: "b", shot_data: { edit_mode: "scene_take" } },
        ],
      ),
    ).toBe(1);
  });
});

describe("expected faces", () => {
  it("asks for both locked faces on every scene take", async () => {
    const { expectedFacesFor, spokenTakeNeedsMeasure } = await import("./editorial.ts");
    expect(spokenTakeNeedsMeasure({ edit_mode: "scene_take", dialogue: null })).toBe(true);
    expect(spokenTakeNeedsMeasure({ edit_mode: "locked_take", dialogue: null, audio_role: "silent" })).toBe(false);
    expect(spokenTakeNeedsMeasure({ edit_mode: "locked_take", dialogue: "Stay.", audio_role: "onscreen" })).toBe(true);
    expect(expectedFacesFor({ edit_mode: "scene_take", blocking: { coverage: "single" } })).toBe(2);
    expect(expectedFacesFor({ edit_mode: "scene_take", blocking: { coverage: "cu" } })).toBe(2);
    expect(expectedFacesFor({ edit_mode: "scene_take", blocking: { coverage: "two_shot" } })).toBe(2);
    expect(expectedFacesFor({ edit_mode: "scene_take", blocking: { coverage: "room" } })).toBe(2);
  });
});
