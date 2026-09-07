import { describe, expect, it } from "vitest";
import { HANDOFF_FADE_SECONDS, handoffFadeWindows, inHandoffFade } from "./mux-audit.ts";
import type { RenderManifest } from "../domain.ts";

function manifest(shots: RenderManifest["shots"]): RenderManifest {
  return {
    version: 1,
    episode_id: "ep",
    shots,
    caption_asset_ids: [],
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: [],
  };
}

describe("mux audit fade windows", () => {
  it("ignores black at scene-take fade joins and still flags a mid-take black", () => {
    const windows = handoffFadeWindows(
      manifest([
        {
          shot_id: "a",
          asset_id: "1",
          in_point_seconds: 0,
          out_point_seconds: 14,
          picture_start_seconds: 0,
          transition_in: "cut",
        },
        {
          shot_id: "b",
          asset_id: "2",
          in_point_seconds: 0,
          out_point_seconds: 14,
          picture_start_seconds: 14,
          transition_in: "fade",
        },
      ]),
    );
    expect(windows.some((row) => row.start < 14 && row.end > 13.5)).toBe(true);
    expect(windows.some((row) => row.start <= 14 && row.end >= 14 + HANDOFF_FADE_SECONDS - 0.01)).toBe(true);
    expect(inHandoffFade(13.9, windows)).toBe(true);
    expect(inHandoffFade(14.1, windows)).toBe(true);
    expect(inHandoffFade(7, windows)).toBe(false);
    const stackedAtZero = handoffFadeWindows(
      manifest([
        {
          shot_id: "a",
          asset_id: "1",
          in_point_seconds: 0,
          out_point_seconds: 13,
          picture_start_seconds: 0,
          transition_in: "cut",
        },
        {
          shot_id: "b",
          asset_id: "2",
          in_point_seconds: 0,
          out_point_seconds: 14,
          picture_start_seconds: 0,
          transition_in: "fade",
        },
      ]),
    );
    expect(inHandoffFade(12.9, stackedAtZero)).toBe(true);
    expect(inHandoffFade(13.1, stackedAtZero)).toBe(true);
    expect(inHandoffFade(0.1, stackedAtZero)).toBe(false);
  });
});
