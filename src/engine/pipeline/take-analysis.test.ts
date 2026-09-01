import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import {
  analyzeTake,
  chestSkinFraction,
  padFromSync,
  pickBestTake,
  scoreTake,
  settleInPointFromDiffs,
  settleInPointFromSteps,
  sheerOrBra,
  slipFromSync,
  syncLagMs,
  type TakeAnalysis,
} from "./take-analysis.ts";

function analysis(overrides: Partial<TakeAnalysis> = {}): TakeAnalysis {
  return {
    version: 2,
    duration_seconds: 5.4,
    has_audio: true,
    settle_in_seconds: 0,
    settle_hop_seconds: 0.1,
    settle_diffs: [],
    mouth_open_seconds: 1.2,
    voice_onset_seconds: 1.22,
    sync_lag_ms: 20,
    viseme_pad_seconds: 0,
    audio_slip_seconds: 0,
    internal_cut_count: 0,
    second_body: false,
    chest_skin_fraction: 0.05,
    modest_reference_fraction: 0.05,
    sheer_or_bra: false,
    face_similarity: null,
    face_count: null,
    measured_at: "t",
    ...overrides,
  };
}

describe("settle detection", () => {
  it("returns 0 when the first frame already matches the settled reference", () => {
    expect(settleInPointFromDiffs([6, 5, 5, 4])).toBe(0);
  });

  it("finds the first stable frame under the threshold and caps at the I2V max", () => {
    // v9 shape: heavy morph for ~3s, then the room stops sliding.
    const diffs = Array.from({ length: 40 }, (_, i) => (i < 30 ? 60 - i : 9));
    expect(settleInPointFromDiffs(diffs)).toBe(3);
    const slow = Array.from({ length: 40 }, () => 40);
    expect(settleInPointFromDiffs(slow)).toBe(3.5);
    const quick = [50, 30, 13, 12, 11];
    expect(settleInPointFromDiffs(quick)).toBe(0.2);
  });

  it("ignores a single lucky frame in the middle of a morph", () => {
    const diffs = [50, 40, 12, 45, 44, 13, 12, 11];
    expect(settleInPointFromDiffs(diffs)).toBe(0.5);
  });

  it("settles on the first calm frame after the morph has happened", () => {
    // v9 Mara shape: still held ~1s (calm, no drift), slide 1.3–3.0s, calm from 3.0s.
    const steps = Array.from({ length: 36 }, (_, i) => (i < 13 ? 4 : i < 30 ? 18 : 13));
    const drift = Array.from({ length: 36 }, (_, i) => (i < 13 ? 2 : i < 30 ? ((i - 13) / 17) * 60 : 60 + (i - 30) * 0.5));
    expect(settleInPointFromSteps(steps, drift)).toBe(3);
    // Seedance-style: never morphs.
    expect(settleInPointFromSteps([5, 4, 4, 3], [0, 1, 1, 2])).toBe(0);
    // Still sliding at the end of the scan.
    expect(settleInPointFromSteps(Array.from({ length: 36 }, () => 30), Array.from({ length: 36 }, (_, i) => i * 2))).toBe(3.5);
    // v9 Eli shape: hard cut at 0.3s, then a steady talking head.
    expect(settleInPointFromSteps([49, 49, 49, 7, 7, 8, 7], [0, 0, 0, 50, 50, 51, 50])).toBe(0.3);
    // A single calm step inside a slide does not count.
    expect(settleInPointFromSteps([40, 38, 9, 37, 35, 8, 7, 6], [0, 20, 40, 45, 50, 60, 60, 60])).toBe(0.5);
  });
});

describe("sync and pad", () => {
  it("does not pad when the mouth leads or the lag is within the trigger", () => {
    expect(padFromSync({ voice: 1.3, mouth: 1.2, wanDialogue: true })).toBe(0);
    expect(padFromSync({ voice: 1.1, mouth: 1.2, wanDialogue: true })).toBe(0);
    expect(syncLagMs(1.1, 1.2)).toBe(-100);
  });

  it("pads by the measured lead when the voice clearly precedes the mouth", () => {
    const pad = padFromSync({ voice: 0.4, mouth: 1.6, wanDialogue: true });
    expect(pad).toBeGreaterThan(1);
    expect(pad).toBeLessThanOrEqual(1.5);
  });

  it("slips audio earlier when the mouth opens well before the voice, within limits", () => {
    // Natural lip-part: leave it.
    expect(slipFromSync({ voice: 3.6, mouth: 3.5 })).toBe(0);
    // v9 Eli: mouth 3.54, voice 3.84 → 300ms lead → slip to a 60ms residual.
    expect(slipFromSync({ voice: 3.84, mouth: 3.54 })).toBe(0.24);
    // Too far ahead to repair: no slip, the score blocks it instead.
    expect(slipFromSync({ voice: 4.5, mouth: 3.5 })).toBe(0);
    const far = scoreTake(analysis({ mouth_open_seconds: 3.5, voice_onset_seconds: 4.5, sync_lag_ms: 1000 }), { dialogueCu: true, lockedTake: true });
    expect(far.blockers).toContain("mouth_leads_voice");
    const slipped = scoreTake(analysis({ mouth_open_seconds: 3.54, voice_onset_seconds: 3.84, sync_lag_ms: 300, audio_slip_seconds: 0.24 }), { dialogueCu: true, lockedTake: true });
    expect(slipped.blockers).toEqual([]);
    expect(slipped.warnings).toContain("mouth_leads_voice_slipped");
  });
});

describe("modesty gate", () => {
  it("flags a chest band far above the modest reference", () => {
    expect(sheerOrBra(0.4, 0.05)).toBe(true);
    expect(sheerOrBra(0.2, 0.05)).toBe(false);
    expect(sheerOrBra(null, 0.05)).toBe(false);
    // No modest reference for this character: never guess.
    expect(sheerOrBra(0.5, null)).toBe(false);
  });

  it("measures skin in the chest band only", () => {
    const w = 10;
    const h = 20;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = Math.round(h * 0.42); y < Math.round(h * 0.64); y += 1) {
      for (let x = Math.round(w * 0.28); x < Math.round(w * 0.72); x += 1) {
        const o = (y * w + x) * 3;
        rgb[o] = 200;
        rgb[o + 1] = 150;
        rgb[o + 2] = 120;
      }
    }
    expect(chestSkinFraction(rgb, w, h)).toBe(1);
    expect(chestSkinFraction(new Uint8Array(w * h * 3), w, h)).toBe(0);
  });
});

describe("take scoring", () => {
  it("blocks the reasons that must never ship and ranks clean takes by score", () => {
    const clean = scoreTake(analysis(), { dialogueCu: true, lockedTake: true });
    expect(clean.blockers).toEqual([]);
    const ghost = scoreTake(analysis({ second_body: true }), { dialogueCu: true, lockedTake: true });
    expect(ghost.blockers).toContain("invented_people");
    const sheer = scoreTake(analysis({ sheer_or_bra: true }), { dialogueCu: true, lockedTake: true });
    expect(sheer.blockers).toContain("modest_dress");
    const cut = scoreTake(analysis({ internal_cut_count: 1 }), { dialogueCu: true, lockedTake: true });
    expect(cut.blockers).toContain("internal_cut");
    const stranger = scoreTake(analysis({ face_similarity: 0.3 }), { dialogueCu: true, lockedTake: true });
    expect(stranger.blockers).toContain("identity_drift");
    const twoFaces = scoreTake(analysis({ face_count: 2 }), { dialogueCu: true, lockedTake: true });
    expect(twoFaces.blockers).toContain("invented_people");
    const mute = scoreTake(analysis({ has_audio: false }), { dialogueCu: true, lockedTake: true });
    expect(mute.blockers).toContain("native_audio_missing");
  });

  it("blocks a take whose mouth opens before the settle point", () => {
    const early = scoreTake(analysis({ settle_in_seconds: 2.5, mouth_open_seconds: 1.8, voice_onset_seconds: 1.8, sync_lag_ms: 0 }), {
      dialogueCu: true,
      lockedTake: true,
    });
    expect(early.blockers).toContain("speaks_before_settle");
  });

  it("prefers the take with the shorter settle and tighter sync", () => {
    const a = { id: "a", verdict: scoreTake(analysis({ settle_in_seconds: 3, sync_lag_ms: 70 }), { dialogueCu: true, lockedTake: true }) };
    const b = { id: "b", verdict: scoreTake(analysis({ settle_in_seconds: 0.6, sync_lag_ms: 10 }), { dialogueCu: true, lockedTake: true }) };
    const c = { id: "c", verdict: scoreTake(analysis({ second_body: true }), { dialogueCu: true, lockedTake: true }) };
    expect(pickBestTake([a, b, c])?.id).toBe("b");
    expect(pickBestTake([c])).toBeNull();
  });
});

describe("analyzeTake on real lock takes", () => {
  const mara = resolve(process.cwd(), "assets/lock-v5-tmp/mara-try1.mp4");
  const still = resolve(process.cwd(), "assets/drama-id-cu-mara-voss-modest.png");

  it("reproduces the v9 hand constants within tolerance", async () => {
    if (!existsSync(mara) || !existsSync(still) || !(await ffmpegAvailable())) return;
    const result = await analyzeTake({
      video: new Uint8Array(readFileSync(mara)),
      still: new Uint8Array(readFileSync(still)),
      dialogueCu: true,
      wanDialogue: true,
    });
    // v9 hand-tuned: settle 3.0, mouth 3.4, voice ≈ 3.38, no sheer, single body.
    expect(result.has_audio).toBe(true);
    expect(result.settle_in_seconds).toBeGreaterThanOrEqual(2.5);
    expect(result.settle_in_seconds).toBeLessThanOrEqual(3.5);
    // She speaks at ~3.38; the cut must not start after her first syllable.
    expect(result.settle_in_seconds).toBeLessThanOrEqual((result.mouth_open_seconds ?? 99));
    expect(result.voice_onset_seconds).not.toBeNull();
    expect(Math.abs((result.voice_onset_seconds ?? 0) - 3.38)).toBeLessThan(0.5);
    expect(result.sheer_or_bra).toBe(false);
    expect(result.second_body).toBe(false);
    expect(result.internal_cut_count).toBe(0);
    const verdict = scoreTake(result, { dialogueCu: true, lockedTake: true });
    expect(verdict.blockers).toEqual([]);
  }, 120_000);
});
