import { describe, expect, it } from "vitest";
import type { RenderManifest } from "../domain.ts";
import { bedSegments, loudnormFilter, parseLoudnormJson } from "./ffmpeg-mix.ts";
import { loudnessReasons, parseEbur128Summary } from "./mux-audit.ts";

function shot(id: string, start: number, len: number, mood: string): RenderManifest["shots"][number] {
  return {
    shot_id: id,
    asset_id: id,
    in_point_seconds: 0,
    out_point_seconds: len,
    picture_start_seconds: start,
    audio_start_seconds: start,
    hold_tail_seconds: 0,
    audio_role: "onscreen",
    music_mood: mood,
  };
}

describe("bed segments", () => {
  it("merges consecutive shots with the same mood and runs the last bed to the end of picture", () => {
    const manifest = {
      version: 1,
      episode_id: "e",
      shots: [shot("a", 0, 4, "estate"), shot("b", 4, 5, "estate"), shot("c", 9, 3, "tension"), shot("d", 12, 4, "romance")],
      caption_asset_ids: [],
      music_asset_ids: [],
      sfx_asset_ids: [],
      transitions: [],
      scenes: [],
    } as RenderManifest;
    expect(bedSegments(manifest, 20)).toEqual([
      { mood: "estate", start: 0, end: 9 },
      { mood: "tension", start: 9, end: 12 },
      { mood: "romance", start: 12, end: 20 },
    ]);
  });

  it("falls back to a single thriller bed for an empty manifest", () => {
    const manifest = { version: 1, episode_id: "e", shots: [], caption_asset_ids: [], music_asset_ids: [], sfx_asset_ids: [], transitions: [], scenes: [] } as RenderManifest;
    expect(bedSegments(manifest, 8)).toEqual([{ mood: "thriller", start: 0, end: 8 }]);
  });
});

describe("two-pass loudness", () => {
  it("parses the analysis JSON ffmpeg prints and builds a linear second pass", () => {
    const stderr = `noise\n[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-19.53",\n\t"input_tp" : "-4.10",\n\t"input_lra" : "9.20",\n\t"input_thresh" : "-29.80",\n\t"output_i" : "-14.01",\n\t"target_offset" : "0.47"\n}\n`;
    const measured = parseLoudnormJson(stderr);
    expect(measured).toEqual({ input_i: -19.53, input_tp: -4.1, input_lra: 9.2, input_thresh: -29.8, target_offset: 0.47 });
    const filter = loudnormFilter(measured);
    expect(filter).toContain("measured_I=-19.53");
    expect(filter).toContain("linear=true");
    expect(loudnormFilter(null)).toBe("loudnorm=I=-14:TP=-1.5:LRA=11");
    expect(parseLoudnormJson("garbage")).toBeNull();
  });

  it("reads the ebur128 summary and gates delivery loudness", () => {
    const summary = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -13.4 LUFS\n    Threshold: -26.1 LUFS\n\n  Loudness range:\n    LRA:         6.9 LU\n\n  True peak:\n    Peak:       -0.9 dBFS\n`;
    const measure = parseEbur128Summary(summary);
    expect(measure).toEqual({ integrated: -13.4, truePeak: -0.9, lra: 6.9 });
    expect(loudnessReasons(measure)).toEqual([]);
    expect(loudnessReasons({ integrated: -18, truePeak: -1 })).toEqual(["loudness_off_target"]);
    expect(loudnessReasons({ integrated: -14, truePeak: 0.2 })).toEqual(["true_peak_over"]);
    expect(loudnessReasons(null)).toEqual([]);
  });
});
