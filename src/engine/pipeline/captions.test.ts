import { describe, expect, it } from "vitest";
import {
  captionsAlongTimeline,
  captionsFromAlignment,
  captionsFromSceneScript,
  cuesFromVtt,
  cuesToAss,
  cuesToVtt,
  holdCaptionsAcrossCuts,
  wrapCaptionLines,
} from "./captions.ts";
import type { AlignmentTrack } from "../domain.ts";

const track = (text: string, start: number, end: number): AlignmentTrack => ({
  text,
  characters: [],
  words: text.split(" ").map((word, index) => ({
    word,
    start: start + index * 0.2,
    end: start + index * 0.2 + 0.18,
  })),
});

describe("captions along the cut", () => {
  it("offsets each shot's phrases by the running picture time", () => {
    const cues = captionsAlongTimeline({
      shotDurations: [4, 5, 4],
      alignments: [null, track("How many Tuesdays Eli", 0, 1.2), track("Then whose name", 0, 0.8)],
    });
    expect(cues[0]?.start).toBeGreaterThanOrEqual(4);
    expect(cues.at(-1)?.start).toBeGreaterThanOrEqual(9);
    expect(captionsFromAlignment(track("How many Tuesdays Eli", 0, 1.2)).length).toBeGreaterThan(0);
  });

  it("merges a short leftover into a 4–8 word block", () => {
    const cues = captionsFromAlignment(track("I wasn't going to say anything tonight.", 0, 2));
    expect(cues).toHaveLength(1);
    expect(cues[0]?.text).toMatch(/tonight/);
    expect(cues[0]!.text.split(/\s+/).length).toBeGreaterThanOrEqual(4);
    expect(cues[0]!.text.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it("writes ASS with 9:16 PlayRes so burns land in the lower third", () => {
    const ass = cuesToAss(cuesFromVtt(cuesToVtt([{ start: 1.35, end: 3.2, text: "How many Tuesdays, Eli." }])));
    expect(ass).toMatch(/PlayResY: 1920/);
    expect(ass).toMatch(/Dialogue: 0,0:00:01\.35,0:00:03\.20,Default/);
  });

  it("wraps a long line so it cannot clip left or right", () => {
    const lines = wrapCaptionLines("Mara Voss will not drop the last unpaid question");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    expect(lines.join(" ")).toMatch(/Mara Voss/);
    expect(lines.join(" ")).toMatch(/question/);
  });

  it("holds a caption over the cut instead of blinking out with it", () => {
    // Take 1's last word lands at 14.4 and take 2's first at 15.2: without a
    // hold the screen is blank across the join.
    const held = holdCaptionsAcrossCuts([
      { start: 12.0, end: 14.4, text: "Forty for the run and I'm gone." },
      { start: 15.2, end: 17.0, text: "Then forty's not enough." },
    ]);
    // Hands over just under the next start: no blank frame, no two plates at
    // once. The gap is far narrower than a frame, so nothing can land in it.
    expect(held[0]!.end).toBeGreaterThan(14.4);
    expect(held[0]!.end).toBeLessThan(15.2);
    expect(15.2 - held[0]!.end).toBeLessThan(1 / 30);
    const offGrid = holdCaptionsAcrossCuts([
      { start: 12.0, end: 14.4, text: "One." },
      { start: 15.213, end: 17, text: "Two." },
    ]);
    expect(offGrid[0]!.end).toBeLessThan(15.213);
    expect(15.213 - offGrid[0]!.end).toBeLessThan(1 / 30);
    expect(held[1]!.end).toBe(17.0);
    // A real beat still clears the screen.
    const beat = holdCaptionsAcrossCuts([
      { start: 0, end: 1.5, text: "Sit down." },
      { start: 6, end: 7, text: "So you're buying me." },
    ]);
    expect(beat[0]!.end).toBe(1.5);
    // Overlaps are pulled back so two plates never stack.
    const overlap = holdCaptionsAcrossCuts([
      { start: 0, end: 3.2, text: "One." },
      { start: 3.0, end: 4.0, text: "Two." },
    ]);
    expect(overlap[0]!.end).toBeLessThan(3.0);
  });

  it("burns the words only and keeps the speaker as cue metadata", () => {
    const cues = captionsAlongTimeline({
      shotDurations: [4],
      alignments: [track("I did not write the paper.", 0, 1.4)],
      pictureStarts: [0],
      speakers: ["Mara Voss"],
    });
    expect(cues[0]?.text).not.toMatch(/MARA:/);
    expect(cues[0]?.text).toMatch(/I did not write the paper/);
    expect(cues[0]?.speaker).toBe("Mara Voss");
  });

  it("attributes each cue to its own speaker instead of the take's first speaker", () => {
    const cues = captionsAlongTimeline({
      shotDurations: [15],
      alignments: [track("How long Don't Three months", 0, 2)],
      pictureStarts: [0],
      speakers: ["Cole"],
      scripts: ["MARA: How long?\nCOLE: Don't.\nMARA: Three months."],
    });
    expect(cues.map((cue) => cue.text.replace(/\n/g, " "))).toEqual([
      "How long?",
      "Don't.",
      "Three months.",
    ]);
    expect(cues.every((cue) => !/^[A-Z]+:/.test(cue.text))).toBe(true);
    expect(cues[0]?.speaker).toBe("MARA");
    expect(cues[1]?.speaker).toBe("COLE");
    expect(cues[0]?.start).toBeCloseTo(0, 5);
    expect(cues[1]?.start).toBeCloseTo(0.4, 5);
    expect(cues[2]?.start).toBeCloseTo(0.6, 5);
    const timed = captionsFromSceneScript("MARA: Stay.\nCOLE: No hospital.", 10, 2);
    expect(timed[0]?.start).toBeGreaterThanOrEqual(2);
    expect(timed[1]?.end).toBeLessThanOrEqual(12.01);
  });

  it("absorbs a one-word tail like 'like.'", () => {
    const cues = captionsFromAlignment(track("Mara it is not what that looks like.", 0, 2));
    expect(cues.at(-1)?.text).toMatch(/like/);
    expect(cues.some((cue) => cue.text.trim() === "like.")).toBe(false);
  });
});
