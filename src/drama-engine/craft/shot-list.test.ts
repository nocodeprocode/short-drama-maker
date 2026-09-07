import { describe, expect, it } from "vitest";
import { sceneTakeShotList, shotListPrompt, spokenLine } from "./shot-list.ts";

describe("scene-take shot list", () => {
  it("cuts a conversation across different camera stations, not one locked two-shot", () => {
    const list = sceneTakeShotList({
      duration: 15,
      takeIndex: 0,
      blocking: { camera_left: "MARA", camera_right: "COLE", upper_frame: "COLE" },
      script: [
        "MARA: How can you do this to me?",
        "COLE: It is none of your concern.",
        "MARA: (voice breaks) But it is my concern, I carried it here.",
        "COLE: Then put it down.",
        "MARA: Whose name is on the tag?",
      ].join("\n"),
    });
    expect(list.map((row) => row.role)).toEqual(["setup", "peak", "answer", "land"]);
    expect(new Set(list.map((row) => row.framing)).size).toBeGreaterThanOrEqual(3);
    expect(list.map((row) => row.framing)).toEqual(["master", "ots", "dirty", "tight_two"]);
    const peak = list.find((row) => row.role === "peak");
    const answer = list.find((row) => row.role === "answer");
    expect(peak?.on).toBe("MARA");
    expect(peak?.direction).toMatch(/Over-the-shoulder|close-up on the person on camera-left/i);
    expect(peak?.direction).toMatch(/voice breaks/);
    expect(answer?.on).toBe("COLE");
    const text = shotListPrompt(list);
    expect(text).toMatch(/Shot 1/);
    expect(text).toMatch(/NEW CAMERA|HARD CUT/);
    expect(text).not.toMatch(/same camera position/);
    expect(text).not.toMatch(/locked-off medium two-shot/);
    expect(text).toMatch(/\{But it is my concern/);
    expect(text).toMatch(/\{Then put it down/);
    expect(text).not.toMatch(/Speak only the text inside \{braces\}/);
    expect(text).not.toMatch(/MARA:/);
    expect(text).not.toMatch(/mouth speaks/);
    expect(text).not.toMatch(/\(voice breaks\)/);
    expect(spokenLine("MARA: (softly) Then say it.")).toBe("Then say it.");
    expect(list.reduce((sum, row) => sum + row.seconds, 0)).toBeLessThanOrEqual(15.5);
  });

  it("writes the entrance into shot 1 and the exit into the last shot", () => {
    const list = sceneTakeShotList({
      duration: 14,
      blocking: { camera_left: "MARA", camera_right: "COLE", enters: ["FELIX"], exits: ["COLE"] },
      script: ["FELIX: Boss—", "COLE: Felix. My ride.", "MARA: Your ride calls you what?", "COLE: (turns and leaves) Late."].join("\n"),
    });
    expect(list[0]!.direction).toMatch(/FELIX enters through the door/);
    expect(list.at(-1)!.direction).toMatch(/COLE turns and walks out/);
    const alley = sceneTakeShotList({
      duration: 14,
      location: "Service alley — rain, wet brick",
      blocking: { camera_left: "MARA", camera_right: "COLE", enters: ["FELIX"] },
      script: ["FELIX: Boss—", "COLE: Felix.", "MARA: Your ride?"].join("\n"),
    });
    expect(alley[0]!.direction).toMatch(/alley mouth|street/);
    expect(alley[0]!.direction).not.toMatch(/through the door/);
  });

  it("puts the peak shot on the mouth that says the line, not the person who talks most", () => {
    const list = sceneTakeShotList({
      duration: 15,
      takeIndex: 1,
      blocking: { camera_left: "MARA", camera_right: "COLE" },
      script: [
        "COLE: Then Mara, do what I say.",
        "MARA: Nobody gives me orders in the rain?",
        "COLE: I count money at a hotel desk at night.",
        "COLE: That is all I am.",
        "COLE: The strap is fake.",
      ].join("\n"),
    });
    const peak = list.find((row) => row.role === "peak");
    const answer = list.find((row) => row.role === "answer");
    expect(peak?.on).toBe("MARA");
    expect(["cu", "dirty"]).toContain(peak?.framing);
    expect(peak?.direction).toMatch(/\{Nobody gives me orders/);
    expect(peak?.direction).toMatch(/stays silent, mouth closed/);
    expect(peak?.direction).not.toMatch(/\{Nobody gives me orders[\s\S]*camera-right: \{Nobody/);
    expect(answer?.on).toBe("COLE");
    expect(answer?.direction).toMatch(/\{I count money/);
  });

  it("cuts a two-line take as a dirty single and the reverse, not one locked frame", () => {
    const list = sceneTakeShotList({ duration: 12, script: "MARA: Who sent it?\nCOLE: Nobody." });
    expect(list).toHaveLength(2);
    expect(list[0]!.framing).toBe("dirty");
    expect(list[1]!.framing).toBe("ots");
    expect(list[0]!.direction).toMatch(/Dirty single on the person on camera/);
    expect(list[1]!.direction).toMatch(/Over-the-shoulder/);
  });

  it("rotates the opening camera across consecutive takes", () => {
    const script = [
      "MARA: How can you do this to me?",
      "COLE: It is none of your concern.",
      "MARA: But it is my concern.",
      "COLE: Then put it down.",
    ].join("\n");
    const a = sceneTakeShotList({ duration: 14, takeIndex: 0, script, blocking: { camera_left: "MARA", camera_right: "COLE" } });
    const b = sceneTakeShotList({ duration: 14, takeIndex: 1, script, blocking: { camera_left: "MARA", camera_right: "COLE" } });
    expect(a[0]!.framing).not.toBe(b[0]!.framing);
    expect(["cu", "tight_two"]).toContain(b[0]!.framing);
    expect(b[0]!.direction).toMatch(/JOIN CUT/);
    expect(b[0]!.framing).not.toBe(a.at(-1)!.framing);
  });
});
