import { describe, expect, it } from "vitest";
import { castLookFromNotes, screenCastLook } from "../engine/pipeline/face-screen.ts";
import { parseCastLook } from "../engine/ai/vision.ts";

/**
 * A pack locked with LED eyes on three actors because the judge described the
 * defect in prose and the gate only ever read the beauty words.
 */
describe("cast look eye gate", () => {
  it("rejects the notes the judge actually wrote", () => {
    expect(castLookFromNotes("Full-body shot of a handsome man with heterochromatic glowing eyes in a suit.")).toContain(
      "eyes_unnatural",
    );
    expect(castLookFromNotes("Striking woman, one eye is a different colour.")).toContain("eyes_unnatural");
    expect(castLookFromNotes("Close portrait with neon eyes.")).toContain("eyes_unnatural");
  });

  it("leaves a normal still alone", () => {
    expect(castLookFromNotes("Close portrait of a striking woman against a plain wall.")).toEqual([]);
    expect(castLookFromNotes("Catchlight in the eyes, natural skin tone.")).toEqual([]);
  });

  it("does not read the canonical plain wall as a plain face", () => {
    expect(castLookFromNotes("Close portrait against a plain warm-grey wall.")).toEqual([]);
    expect(castLookFromNotes("Striking woman, plain backdrop, soft daylight.")).toEqual([]);
    expect(castLookFromNotes("Full-body shot against a plain grey studio wall.")).toEqual([]);
  });

  it("still rejects a plain face", () => {
    expect(castLookFromNotes("A plain, tired face against a plain wall.")).toContain("face_plain");
    expect(castLookFromNotes("Her features are average and unremarkable.")).toContain("face_plain");
  });

  it("fails the screen on the verdict flag", () => {
    const verdict = screenCastLook({ eyesNatural: false, close: true, modest: true, beauty: true });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain("eyes_unnatural");
  });

  it("still reads eye notes for a faithful likeness, where beauty notes are suppressed", () => {
    const verdict = screenCastLook({
      notes: null,
      eyeNotes: "His left iris glows amber.",
      close: true,
      modest: true,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain("eyes_unnatural");
  });

  it("does not call a plain-looking likeness plain", () => {
    const verdict = screenCastLook({ notes: null, eyeNotes: "A tired, average face.", close: true, modest: true });
    expect(verdict.reasons).not.toContain("face_plain");
  });

  it("passes a clean still", () => {
    const verdict = screenCastLook({
      notes: "Close portrait against a plain wall.",
      eyeNotes: "Close portrait against a plain wall.",
      beauty: true,
      modest: true,
      close: true,
      eyesNatural: true,
    });
    expect(verdict.pass).toBe(true);
  });

  it("treats a missing eyes_natural answer as no defect", () => {
    const look = parseCastLook(JSON.stringify({ beauty: true, close: true, modest: true, notes: "ok" }), "m");
    expect(look.eyes_natural).toBe(true);
    expect(screenCastLook({ eyesNatural: look.eyes_natural, close: true, modest: true, beauty: true }).pass).toBe(true);
  });

  it("parses a reported eye defect with its evidence", () => {
    const look = parseCastLook(
      JSON.stringify({ beauty: true, close: true, modest: true, eyes_natural: false, eye_evidence: "left iris glows", notes: "ok" }),
      "m",
    );
    expect(look.eyes_natural).toBe(false);
    expect(look.eye_evidence).toBe("left iris glows");
  });
});
