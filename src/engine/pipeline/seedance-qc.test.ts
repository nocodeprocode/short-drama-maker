import { describe, expect, it } from "vitest";
import { joinCutFailReasons, nameLeakReasons, sceneTakeObedienceReasons } from "./seedance-qc.ts";

describe("seedance QC helpers", () => {
  it("blocks a spoken name label and an unplanned lead name", () => {
    expect(
      nameLeakReasons("Mara says don't", { namedCast: ["Mara Voss", "Cole"], script: "the person on camera-left: {Don't.}" }),
    ).toContain("name_label_spoken");
    expect(
      nameLeakReasons("Cole, look at me", { namedCast: ["Mara", "Cole"], script: "the person on camera-right: {Look at me.}" }),
    ).toContain("name_spoken");
    expect(
      nameLeakReasons("Don't say that", {
        namedCast: ["Mara", "Cole"],
        script: "Mara: Don't say that.\nCole: Look at me.",
      }),
    ).toEqual([]);
  });

  it("blocks a join that reopens on a wide master after take 0", () => {
    expect(joinCutFailReasons({ face_box: { x: 0.4, y: 0.4, width: 0.08, height: 0.09 }, face_count: 2 }, 1)).toEqual([
      "join_cut_wide",
    ]);
    expect(joinCutFailReasons({ face_box: { x: 0.2, y: 0.2, width: 0.45, height: 0.09 }, face_count: 2 }, 1)).toEqual([
      "join_cut_wide",
    ]);
    expect(joinCutFailReasons({ face_box: { x: 0.2, y: 0.15, width: 0.45, height: 0.4 }, face_count: 2 }, 1)).toEqual([]);
    expect(joinCutFailReasons({ face_box: { x: 0.4, y: 0.4, width: 0.08, height: 0.09 }, face_count: 2 }, 0)).toEqual([]);
    expect(joinCutFailReasons({ face_box: null, face_count: 0 }, 2)).toEqual(["join_cut_wide"]);
  });

  it("combines name-leak and join-cut for a scene take", () => {
    const reasons = sceneTakeObedienceReasons({
      transcript: "Mara says wait",
      namedCast: ["Mara", "Cole"],
      script: "the person on camera-left: {Wait.}",
      analysis: { face_box: { x: 0.4, y: 0.4, width: 0.07, height: 0.08 }, face_count: 2 },
      takeIndex: 1,
    });
    expect(reasons).toEqual(expect.arrayContaining(["name_label_spoken", "join_cut_wide"]));
  });
});
