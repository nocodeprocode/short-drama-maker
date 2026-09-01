import { describe, expect, it } from "vitest";
import { buildPortraitMp4 } from "./mp4.ts";
import { probeVideoBytes } from "./probe.ts";

describe("probeVideoBytes", () => {
  it("reads duration, portrait size, and audio from a real MP4 container", () => {
    const probe = probeVideoBytes(buildPortraitMp4(4));
    expect(probe.exists).toBe(true);
    expect(probe.decodes).toBe(true);
    expect(probe.duration_seconds).toBe(4);
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.has_audio).toBe(true);
  });

  it("does not invent a passing probe for empty bytes", () => {
    const probe = probeVideoBytes(new Uint8Array());
    expect(probe.exists).toBe(false);
    expect(probe.decodes).toBe(false);
  });
});
