import { describe, expect, it } from "vitest";
import {
  CUT_RULES,
  cutIsLegal,
  cutMoveOf,
  cutProblems,
  cutSound,
  joinOpenSize,
  repairCutFraming,
  sizeOfFraming,
} from "./cut.ts";

describe("CUT — every cut must move", () => {
  it("forbids the same size on the same face and repairs it", () => {
    expect(CUT_RULES).toMatch(/Every cut MUST move/);
    expect(CUT_RULES).toMatch(/<swish>/);
    expect(sizeOfFraming("dirty")).toBe("mcu");
    expect(sizeOfFraming("master")).toBe("cowboy");
    expect(sizeOfFraming("cu")).toBe("cu");
    expect(
      cutIsLegal({ framing: "dirty", on: "NYLA" }, { framing: "ots", on: "NYLA" }),
    ).toBe(false);
    expect(
      cutIsLegal({ framing: "dirty", on: "NYLA" }, { framing: "cu", on: "NYLA" }),
    ).toBe(true);
    expect(
      cutIsLegal({ framing: "dirty", on: "NYLA" }, { framing: "dirty", on: "ROMAN" }),
    ).toBe(true);
    expect(
      cutIsLegal({ framing: "ots", on: "NYLA" }, { framing: "insert", on: null }),
    ).toBe(true);
    expect(cutMoveOf({ framing: "master", on: "NYLA" }, { framing: "cu", on: "NYLA" })).toBe("closer");
    expect(cutMoveOf({ framing: "cu", on: "NYLA" }, { framing: "master", on: "NYLA" })).toBe("wider");
    expect(cutMoveOf({ framing: "dirty", on: "NYLA" }, { framing: "ots", on: "ROMAN" })).toBe("reverse");
    expect(repairCutFraming({ framing: "dirty", on: "NYLA" }, "ots", "NYLA", "the envelope")).toBe("cu");
    expect(cutSound("closer")).toMatch(/<swish>/);
    expect(cutSound("insert")).toMatch(/<whoosh>/);
    expect(joinOpenSize("dirty")).toBe("master");
    expect(joinOpenSize("master")).toBe("dirty");
    expect(
      cutProblems([
        { framing: "dirty", on: "NYLA" },
        { framing: "ots", on: "NYLA" },
      ]).map((hit) => hit.kind),
    ).toEqual(["same_size_same_face"]);
    expect(
      cutProblems([{ framing: "dirty", on: "NYLA" }], "ots").map((hit) => hit.kind),
    ).toEqual(["join_reprint"]);
    expect(
      cutProblems([
        { framing: "master", on: "NYLA" },
        { framing: "cu", on: "NYLA" },
        { framing: "dirty", on: "ROMAN" },
      ]),
    ).toEqual([]);
  });
});
