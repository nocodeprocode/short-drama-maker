import { describe, expect, it } from "vitest";
import { parseIdentityJudgement, type VisionEngine } from "../ai/vision.ts";
import { identitySampleTimes, runIdentityStage } from "./identity-check.ts";
import { scoreTake, type TakeAnalysis } from "./take-analysis.ts";

function analysis(overrides: Partial<TakeAnalysis> = {}): TakeAnalysis {
  return {
    version: 2,
    duration_seconds: 5.2,
    has_audio: true,
    settle_in_seconds: 1.0,
    settle_hop_seconds: 0.1,
    settle_diffs: [],
    mouth_open_seconds: 1.5,
    voice_onset_seconds: 1.52,
    sync_lag_ms: 20,
    viseme_pad_seconds: 0,
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

const video = new Uint8Array(4_096);
const frames = async () => [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];

function judge(same: number, faces: number): VisionEngine {
  return {
    async judgeIdentity() {
      return { same_person: same, face_count: faces, notes: "stub", model: "stub" };
    },
  };
}

describe("identity judgement parsing", () => {
  it("accepts fenced JSON and clamps the score", () => {
    const parsed = parseIdentityJudgement('```json\n{"face_count": 1.0, "same_person": 1.4, "notes": "same scar"}\n```', "m");
    expect(parsed).toEqual({ face_count: 1, same_person: 1, notes: "same scar", model: "m" });
    expect(parseIdentityJudgement('{"face_count":"2","same_person":"0.2"}', "m").face_count).toBe(2);
    expect(parseIdentityJudgement('{"face_count":0}', "m").same_person).toBe(0.5);
  });
});

describe("identity stage", () => {
  it("samples after the settle, mid-take, and near the tail", () => {
    expect(identitySampleTimes({ duration_seconds: 5.2, settle_in_seconds: 1.0 })).toEqual([1.25, 3.05, 4.85]);
    expect(identitySampleTimes({ duration_seconds: 1.0, settle_in_seconds: 3 })).toEqual([0.8]);
  });

  it("writes face count and likeness onto the analysis and the score blocks a stranger", async () => {
    const result = await runIdentityStage({
      video,
      reference: new Uint8Array([9, 9]),
      analysis: analysis(),
      expectedFaces: 1,
      vision: judge(0.31, 1),
      sampleFrames: frames,
    });
    expect(result.skipped).toBeNull();
    expect(result.analysis.face_similarity).toBe(0.31);
    expect(result.analysis.face_count).toBe(1);
    const verdict = scoreTake(result.analysis, { dialogueCu: true, lockedTake: true, expectedFaces: 1 });
    expect(verdict.blockers).toContain("identity_drift");
  });

  it("never scores likeness without a reference, and an empty wide with a person is invented_people", async () => {
    const result = await runIdentityStage({
      video,
      reference: null,
      analysis: analysis(),
      expectedFaces: 0,
      vision: judge(1, 1),
      sampleFrames: frames,
    });
    expect(result.analysis.face_similarity).toBeNull();
    expect(result.analysis.face_count).toBe(1);
    const verdict = scoreTake(result.analysis, { dialogueCu: false, lockedTake: true, expectedFaces: 0 });
    expect(verdict.blockers).toContain("invented_people");
    const clean = await runIdentityStage({
      video,
      reference: null,
      analysis: analysis(),
      expectedFaces: 0,
      vision: judge(1, 0),
      sampleFrames: frames,
    });
    expect(scoreTake(clean.analysis, { dialogueCu: false, lockedTake: true, expectedFaces: 0 }).blockers).toEqual([]);
  });

  it("leaves the analysis untouched when frames or the judge are unavailable", async () => {
    const noFrames = await runIdentityStage({
      video,
      reference: null,
      analysis: analysis(),
      expectedFaces: 1,
      vision: judge(1, 1),
      sampleFrames: async () => [],
    });
    expect(noFrames.skipped).toBe("no_frames");
    expect(noFrames.analysis.face_count).toBeNull();
    const failing: VisionEngine = {
      async judgeIdentity() {
        throw new Error("HTTP 503");
      },
    };
    const failed = await runIdentityStage({
      video,
      reference: null,
      analysis: analysis(),
      expectedFaces: 1,
      vision: failing,
      sampleFrames: frames,
    });
    expect(failed.skipped).toMatch(/^judge_failed:HTTP 503/);
    expect(failed.analysis.face_count).toBeNull();
  });
});
