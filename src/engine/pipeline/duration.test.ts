import { describe, expect, it } from "vitest";
import { DIALOGUE_DURATION_WINDOW, VIDEO_ROUTES } from "../config/models.ts";
import { finalizeShotDuration } from "./duration.ts";

describe("audio-before-duration", () => {
  it("sets duration from the wav plus handles", () => {
    const decision = finalizeShotDuration({
      wavSeconds: 5,
      route: VIDEO_ROUTES.dialogue_default,
      headHandle: 0.35,
      tailHandle: 0.35,
    });
    expect(decision.duration_seconds).toBeCloseTo(5.7);
    expect(decision.needs_reaction_pad).toBe(false);
  });

  it("pads short lines to the model minimum instead of stretching delivery", () => {
    const decision = finalizeShotDuration({
      wavSeconds: 0.8,
      route: VIDEO_ROUTES.dialogue_default,
    });
    expect(decision.duration_seconds).toBe(VIDEO_ROUTES.dialogue_default.min_duration_seconds);
    expect(decision.needs_reaction_pad).toBe(true);
  });

  it("clamps long lines to the Seedance 15s window", () => {
    const decision = finalizeShotDuration({
      wavSeconds: 40,
      route: VIDEO_ROUTES.dialogue_default,
    });
    expect(decision.duration_seconds).toBe(15);
  });

  it("clamps a 20s line to the 10s dialogue craft window", () => {
    const decision = finalizeShotDuration({
      wavSeconds: 20,
      route: DIALOGUE_DURATION_WINDOW,
    });
    expect(decision.duration_seconds).toBe(10);
  });
});
