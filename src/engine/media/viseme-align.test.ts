import { describe, expect, it } from "vitest";
import {
  DIALOGUE_ONSET_IGNORE_PLANTS_SECONDS,
  firstVoicedSecond,
  I2V_SETTLE_DEFAULT_SECONDS,
  i2vSettleInPointSeconds,
  visemeAlignPlan,
  visemeAudioPadSeconds,
  WAN_DIALOGUE_DEFAULT_PAD_SECONDS,
} from "./viseme-align.ts";

describe("viseme audio pad", () => {
  it("clamps a long voice-lead pad between 0.4s and 1.5s", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: 2,
      }),
    ).toBeCloseTo(1.5, 5);
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: 0.4,
      }),
    ).toBeCloseTo(0.4, 5);
  });

  it("pads an Eli-like 1.0s voice-lead so output onsets sit within 150ms", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: 1.0,
        wanDialogue: true,
      }),
    ).toBeCloseTo(1.0, 5);
    const plan = visemeAlignPlan({
      voiceOnsetSeconds: 0,
      mouthOpenSeconds: 1.0,
      wanDialogue: true,
      takeDurationSeconds: 6,
    });
    const voiceOut = plan.audioDelayAfterTrimSeconds;
    const mouthOut = 1.0 - plan.pictureInPointSeconds;
    expect(Math.abs(voiceOut - mouthOut)).toBeLessThanOrEqual(0.15);
  });

  it("does not pad when voice and mouth already sit inside 80ms", () => {
    expect(visemeAudioPadSeconds({ voiceOnsetSeconds: 2, mouthOpenSeconds: 2 })).toBe(0);
    expect(visemeAudioPadSeconds({ voiceOnsetSeconds: 1.95, mouthOpenSeconds: 2 })).toBe(0);
    expect(visemeAudioPadSeconds({ voiceOnsetSeconds: 0, mouthOpenSeconds: 0.05 })).toBe(0);
  });

  it("does not invent a pad when a probe is missing and this is not Wan dialogue", () => {
    expect(visemeAudioPadSeconds({ voiceOnsetSeconds: 0, mouthOpenSeconds: null })).toBe(0);
    expect(visemeAudioPadSeconds({ voiceOnsetSeconds: null, mouthOpenSeconds: 2 })).toBe(0);
  });

  it("leaves an already-aligned take (3.38 vs 3.4) at pad 0, even on Wan", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 3.38,
        mouthOpenSeconds: 3.4,
        wanDialogue: true,
      }),
    ).toBe(0);
    const plan = visemeAlignPlan({
      voiceOnsetSeconds: 3.38,
      mouthOpenSeconds: 3.4,
      wanDialogue: true,
      takeDurationSeconds: 6,
    });
    expect(plan.padSeconds).toBe(0);
    expect(plan.audioDelayAfterTrimSeconds).toBe(0);
    expect(plan.pictureInPointSeconds).toBe(0);
  });

  it("does not pad when mouth is already open and voice is late", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 4.2,
        mouthOpenSeconds: 3.4,
        wanDialogue: true,
      }),
    ).toBe(0);
  });

  it("pads at least 1.2s when mouth is unknown and voice leads picture motion", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: null,
        wanDialogue: true,
      }),
    ).toBe(0);
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: null,
        motionPeakSeconds: 1.2,
        wanDialogue: true,
      }),
    ).toBeGreaterThanOrEqual(WAN_DIALOGUE_DEFAULT_PAD_SECONDS);
  });

  it("keeps native 1.2s lead and mouth_open at 1.2s within 80ms on the output clock", () => {
    const plan = visemeAlignPlan({
      voiceOnsetSeconds: 0,
      mouthOpenSeconds: 1.2,
      wanDialogue: true,
      takeDurationSeconds: 5,
    });
    const voiceOut = 0 + plan.audioDelayAfterTrimSeconds;
    const mouthOut = 1.2 - plan.pictureInPointSeconds;
    expect(Math.abs(voiceOut - mouthOut)).toBeLessThanOrEqual(0.081);
    expect(0 + plan.padSeconds).toBeGreaterThanOrEqual(1.2 - 0.08);
  });

  it("raises the Wan floor when a later motion peak still leads the padded voice", () => {
    expect(
      visemeAudioPadSeconds({
        voiceOnsetSeconds: 0,
        mouthOpenSeconds: null,
        motionPeakSeconds: 1.8,
        wanDialogue: true,
      }),
    ).toBeCloseTo(1.72, 5);
  });

  it("finds the first voiced sample, not a later peak", () => {
    const rate = 16000;
    const samples = new Int16Array(rate * 3);
    for (let i = Math.round(rate * 2); i < samples.length; i += 1) samples[i] = i % 2 === 0 ? 12000 : -12000;
    expect(firstVoicedSecond(samples, rate)).toBeCloseTo(2, 1);
  });

  it("defaults I2V dialogue CUs to a 1.5s settle cut, or a later stable frame", () => {
    expect(i2vSettleInPointSeconds()).toBe(1.5);
    expect(I2V_SETTLE_DEFAULT_SECONDS).toBe(1.5);
    expect(
      i2vSettleInPointSeconds({
        hopSeconds: 0.1,
        diffsVsSettled: [40, 38, 35, 30, 22, 18, 12, 8],
      }),
    ).toBe(1.5);
    expect(
      i2vSettleInPointSeconds({
        hopSeconds: 0.1,
        diffsVsSettled: [...Array.from({ length: 20 }, () => 40), 10],
      }),
    ).toBeCloseTo(2.0, 5);
  });

  it("does not use the plant / slate region as the dialogue line onset", () => {
    const rate = 16000;
    const samples = new Int16Array(rate * 8);
    for (let i = Math.round(rate * 1.0); i < Math.round(rate * 1.4); i += 1) {
      samples[i] = i % 2 === 0 ? 12000 : -12000;
    }
    for (let i = Math.round(rate * 5.5); i < samples.length; i += 1) {
      samples[i] = i % 2 === 0 ? 12000 : -12000;
    }
    expect(firstVoicedSecond(samples, rate)).toBeCloseTo(1, 1);
    expect(firstVoicedSecond(samples, rate, DIALOGUE_ONSET_IGNORE_PLANTS_SECONDS)).toBeCloseTo(5.5, 1);
  });
});
