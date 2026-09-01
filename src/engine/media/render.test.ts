import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { encodePortraitSlate } from "./ffmpeg-mix.ts";
import { RenderFailedError, renderEpisodeBytes } from "./render.ts";
import type { RenderManifest } from "../domain.ts";

const manifest: RenderManifest = {
  version: 1,
  episode_id: "ep1",
  shots: [
    { shot_id: "s1", asset_id: "a1", in_point_seconds: 0, out_point_seconds: 4 },
    { shot_id: "s2", asset_id: "a2", in_point_seconds: 0, out_point_seconds: 4 },
  ],
  caption_asset_ids: [],
  music_asset_ids: [],
  sfx_asset_ids: [],
  transitions: [{ after_shot_id: "s1", type: "cut" }],
};

describe("render fails closed", () => {
  it("throws instead of shipping a non-MP4 byte bag", async () => {
    const input = {
      manifest,
      shotBodies: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
      alignments: [],
    };
    await expect(renderEpisodeBytes(input)).rejects.toBeInstanceOf(RenderFailedError);
  });

  it("rejects a manifest/body count mismatch", async () => {
    await expect(
      renderEpisodeBytes({ manifest, shotBodies: [new Uint8Array([1])], alignments: [] }),
    ).rejects.toThrow(/2 shots but 1 bodies/);
  });

  it("outputs an MP4 when ffmpeg can mix real takes", async () => {
    if (!(await ffmpegAvailable())) return;
    const slate = await encodePortraitSlate(2);
    expect(slate).toBeTruthy();
    const rendered = await renderEpisodeBytes({
      manifest: {
        ...manifest,
        shots: manifest.shots.map((shot, index) => ({
          ...shot,
          picture_start_seconds: index * 2,
          audio_start_seconds: index * 2,
          scene_kind: index === 1 ? "button" : "dialogue",
          transition_in: index === 1 ? "lcut" : "cut",
        })),
        scenes: [
          { index: 0, kind: "dialogue", shot_ids: ["s1"] },
          { index: 1, kind: "button", shot_ids: ["s2"] },
        ],
      },
      shotBodies: [slate!, slate!],
      alignments: [],
    });
    expect(rendered.container).toBe("mp4");
    expect(String.fromCharCode(...rendered.body.slice(4, 8))).toBe("ftyp");
  });
});
