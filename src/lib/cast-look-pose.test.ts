import { describe, expect, it } from "vitest";
import { castLookFromHeadTurn, screenCastLook } from "../engine/pipeline/face-screen.ts";
import { parseCastLook } from "../engine/ai/vision.ts";
import { stillRetryNote } from "../engine/pipeline/still-retry.ts";

/**
 * Naming the turn in the prompt was not enough. Anchoring an angle on the
 * locked front bought one identity but copied its head angle too, so every
 * "profile" came back as a deep three-quarter with both eyes showing.
 */
describe("head turn gate", () => {
  it("rejects a three-quarter that was asked for a profile", () => {
    expect(castLookFromHeadTurn("profile", "three_quarter")).toContain("pose_mismatch");
    expect(castLookFromHeadTurn("profile", "front")).toContain("pose_mismatch");
  });

  it("accepts a true profile", () => {
    expect(castLookFromHeadTurn("profile", "profile")).toEqual([]);
  });

  it("only rejects a three-quarter that did not turn at all", () => {
    expect(castLookFromHeadTurn("three_quarter", "front")).toContain("pose_mismatch");
    expect(castLookFromHeadTurn("three_quarter", "three_quarter")).toEqual([]);
    expect(castLookFromHeadTurn("three_quarter", "profile")).toEqual([]);
  });

  it("leaves the front tolerant of a small turn but rejects a side view", () => {
    expect(castLookFromHeadTurn("front", "three_quarter")).toEqual([]);
    expect(castLookFromHeadTurn("front", "profile")).toContain("pose_mismatch");
  });

  it("does not judge the turn on kinds that have no pose of their own", () => {
    expect(castLookFromHeadTurn("full_body", "front")).toEqual([]);
    expect(castLookFromHeadTurn("cu", "profile")).toEqual([]);
  });

  it("treats a missing turn as no defect, so an older judge cannot fail a pack", () => {
    expect(castLookFromHeadTurn("profile", null)).toEqual([]);
    const look = parseCastLook(JSON.stringify({ beauty: true, close: true, modest: true, notes: "ok" }), "m");
    expect(look.head_turn).toBeUndefined();
    expect(screenCastLook({ kind: "profile", headTurn: look.head_turn ?? null, close: true, modest: true, beauty: true }).pass).toBe(
      true,
    );
  });

  it("parses the turn the judge reports, however it is spelled", () => {
    const look = parseCastLook(
      JSON.stringify({ beauty: true, close: true, modest: true, head_turn: "Three-Quarter", notes: "ok" }),
      "m",
    );
    expect(look.head_turn).toBe("three_quarter");
  });

  it("fails the screen when the still kind and the turn disagree", () => {
    const verdict = screenCastLook({
      kind: "profile",
      headTurn: "three_quarter",
      notes: "Close portrait against a plain wall.",
      beauty: true,
      modest: true,
      close: true,
      eyesNatural: true,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toEqual(["pose_mismatch"]);
  });
});

describe("retry correction", () => {
  it("tells the model what was actually rejected", () => {
    expect(stillRetryNote("CAST_LOOK: pose_mismatch")).toMatch(/turn the head/i);
    expect(stillRetryNote("CAST_LOOK: eyes_unnatural (left iris glows)")).toMatch(/matte/i);
    expect(stillRetryNote("CAST_LOOK: production_gear (softbox top left)")).toMatch(/plain wall/i);
  });

  it("does not blame production gear for an unrelated failure", () => {
    expect(stillRetryNote("CAST_LOOK: pose_mismatch")).not.toMatch(/tripod/i);
  });

  it("carries every reason of a combined rejection", () => {
    const note = stillRetryNote("CAST_LOOK: pose_mismatch, eyes_unnatural");
    expect(note).toMatch(/turn the head/i);
    expect(note).toMatch(/matte/i);
  });

  it("says nothing on a first attempt or an unreadable error", () => {
    expect(stillRetryNote(null)).toBe("");
    expect(stillRetryNote("fetch failed")).toBe("");
  });
});
