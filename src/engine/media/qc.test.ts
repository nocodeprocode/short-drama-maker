import { describe, expect, it } from "vitest";
import { blockingQcReasons, foldSpoken, mechanicalQc, normalizeDialogue } from "./qc.ts";

const portrait = {
  exists: true,
  decodes: true,
  duration_seconds: 4,
  width: 1080,
  height: 1920,
  has_audio: true,
  black_frames: false,
};

describe("mechanical QC", () => {
  it("fails dialogue when the container has no audio track", () => {
    const verdict = mechanicalQc({
      probe: { ...portrait, has_audio: false },
      expectedDuration: 4,
      requireAudio: true,
      expectedDialogue: "You knew about this for three months.",
      outputTranscript: null,
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain("audio_missing");
  });

  it("fails when the output transcript is not the locked line", () => {
    const verdict = mechanicalQc({
      probe: portrait,
      expectedDuration: 4,
      requireAudio: true,
      expectedDialogue: "You knew about this for three months.",
      outputTranscript: "I never said that.",
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toContain("transcript_mismatch");
  });

  it("allows a two-second duration drift in autopilot", () => {
    const verdict = mechanicalQc({
      probe: { ...portrait, duration_seconds: 5.5 },
      expectedDuration: 4,
      requireAudio: true,
      expectedDialogue: null,
      outputTranscript: null,
      durationToleranceSeconds: 2,
    });
    expect(verdict.pass).toBe(true);
  });

  it("does not treat stt_sample_failed or duration_mismatch as blocking", () => {
    expect(blockingQcReasons(["stt_sample_failed", "duration_mismatch"])).toEqual([]);
    expect(blockingQcReasons(["first_frame_not_cu", "insert_used_face_still"])).toEqual([]);
    expect(blockingQcReasons(["stt_sample_failed", "audio_missing"])).toEqual(["audio_missing"]);
    expect(blockingQcReasons(["internal_cut"])).toEqual([]);
  });

  it("treats punctuation as irrelevant when comparing dialogue", () => {
    expect(normalizeDialogue("You knew about this for three months.")).toBe(
      normalizeDialogue("you knew about this for three months"),
    );
    expect(foldSpoken("You knew about this for 3 months.")).toBe(
      foldSpoken("you knew about this for three months"),
    );
  });
});
