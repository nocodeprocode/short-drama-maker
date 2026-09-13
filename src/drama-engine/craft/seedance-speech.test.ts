import { describe, expect, it } from "vitest";
import { cameraWho, campWhoosh, seedanceSpeech, seedanceSpeechBlock } from "./seedance-speech.ts";

describe("Seedance speech", () => {
  it("puts lines in braces and never dumps NAME: labels", () => {
    const text = seedanceSpeech(["ELENA: I can't go there.", "ALYSSA: You're burning up."], {
      left: "ELENA",
      right: "ALYSSA",
    });
    expect(text).toMatch(/\{I can't go there\.\}/);
    expect(text).toMatch(/\{You're burning up\.\}/);
    const run = seedanceSpeech(["NYLA: I opened your envelope.", "NYLA: It was already cracked, so don't start."], {
      left: "NYLA",
      right: "ROMAN",
    });
    expect(run).toMatch(/\{I opened your envelope — It was already cracked, so don't start\.\}/);
    expect(run.replace(/\{braces\}/g, "").match(/\{/g)?.length).toBe(1);
    expect(text).toMatch(/camera-left/);
    expect(text).toMatch(/Never speak a character name/);
    expect(text).not.toMatch(/ELENA:/);
    expect(text).not.toMatch(/ALYSSA:/);
    expect(text).not.toMatch(/mouth speaks/);
    const block = seedanceSpeechBlock("ELENA: I can't go there.\nALYSSA: You're burning up.", {
      camera_left: "ELENA",
      camera_right: "ALYSSA",
    });
    expect(block).toMatch(/Native speech/);
    expect(block).toMatch(/SAME BREATH/);
    expect(block).not.toMatch(/^ELENA:/m);
    expect(campWhoosh("almost smiles")).toMatch(/whoosh/);
    expect(campWhoosh("voice breaks")).toBe("");
    expect(cameraWho("FELIX", "ELENA", "ALYSSA")).toBe("the third person");
    expect(cameraWho("ELENA", "ELENA", "ALYSSA")).toBe("the person on camera-left");
  });
});
