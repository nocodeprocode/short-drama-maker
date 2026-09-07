import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { cuesToSrt } from "../pipeline/captions.ts";
import { probeVideoBytes } from "./probe.ts";
import { DELIVERABLE_SIZES, reframeFilter, reframeMp4 } from "./reframe.ts";

describe("deliverables", () => {
  it("writes SubRip with comma milliseconds and NAME: lines intact", () => {
    const srt = cuesToSrt([
      { start: 0.38, end: 3.38, text: "MARA: Eli, look at Tuesday." },
      { start: 3.5, end: 6.2, text: "ELI: I did not write the paper." },
    ]);
    expect(srt).toContain("1\n00:00:00,380 --> 00:00:03,380\nMARA: Eli, look at Tuesday.");
    expect(srt).toContain("2\n00:00:03,500 --> 00:00:06,200\nELI: I did not write the paper.");
    expect(srt).not.toContain("WEBVTT");
  });

  it("keeps the caption band inside the square crop and pillarboxes landscape", () => {
    // Captions sit at 70–82% of a 1920px frame (1344–1574px) and a CU's eyes and
    // mouth at roughly 30–55% (576–1056px). Both must lie inside the square crop.
    const crop = reframeFilter("1:1");
    expect(crop).toContain("crop=iw:iw");
    const top = (1920 - 1080) * 0.61;
    expect(top).toBeLessThanOrEqual(576);
    expect(top + 1080).toBeGreaterThanOrEqual(1574);
    expect(reframeFilter("16:9")).toContain("boxblur");
    expect(DELIVERABLE_SIZES["16:9"]).toEqual({ width: 1920, height: 1080 });
  });

  it("re-frames the engine lock into 1:1 and 16:9 with audio intact", async () => {
    const master = resolve(process.cwd(), "assets/drama-lock-v9-engine.mp4");
    if (!existsSync(master) || !(await ffmpegAvailable())) return;
    const body = new Uint8Array(readFileSync(master));
    for (const aspect of ["1:1", "16:9"] as const) {
      const out = await reframeMp4(body, aspect);
      expect(out).not.toBeNull();
      const probe = probeVideoBytes(out!);
      expect(probe.width).toBe(DELIVERABLE_SIZES[aspect].width);
      expect(probe.height).toBe(DELIVERABLE_SIZES[aspect].height);
      expect(probe.has_audio).toBe(true);
      expect(Math.abs(probe.duration_seconds - probeVideoBytes(body).duration_seconds)).toBeLessThan(0.2);
    }
  }, 300_000);
});
