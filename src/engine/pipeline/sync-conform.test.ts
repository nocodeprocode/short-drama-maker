import { describe, expect, it } from "vitest";
import type { MuxAudit, MuxAuditLine } from "../media/mux-audit.ts";
import { conformCorrections, onlyConformable } from "./sync-conform.ts";
import type { TakeAnalysis } from "./take-analysis.ts";

function analysis(over: Partial<TakeAnalysis> = {}): TakeAnalysis {
  return {
    version: 2,
    duration_seconds: 6,
    has_audio: true,
    settle_in_seconds: 1.2,
    settle_hop_seconds: 0.1,
    settle_diffs: [],
    mouth_open_seconds: 1.5,
    voice_onset_seconds: 0,
    sync_lag_ms: null,
    viseme_pad_seconds: 0.3,
    audio_slip_seconds: 0,
    audio_skip_seconds: 0,
    internal_cut_count: 0,
    second_body: false,
    chest_skin_fraction: null,
    modest_reference_fraction: null,
    sheer_or_bra: false,
    face_similarity: null,
    face_count: 1,
    measured_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function line(over: Partial<MuxAuditLine>): MuxAuditLine {
  return {
    shot_id: "s1",
    speaker: "A",
    picture_start_s: 10,
    expected_voice_s: 10.3,
    voice_onset_s: 12.5,
    mouth_open_s: 10.3,
    lag_ms: -2200,
    limit_ms: 200,
    pass: false,
    head_step: 5,
    settled_open: true,
    ...over,
  };
}

function audit(lines: MuxAuditLine[], extraReasons: string[] = []): MuxAudit {
  return {
    version: 1,
    ship: false,
    reasons: [...lines.filter((row) => !row.pass).map((row) => `sync:${row.shot_id}`), ...extraReasons],
    duration_seconds: 60,
    expected_duration_seconds: 60,
    has_audio: true,
    black_frames: 0,
    integrated_lufs: -14,
    true_peak_dbfs: -1,
    loudness_range_lu: 8,
    lines,
    measured_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("sync conform", () => {
  it("moves a late voice earlier: pad first, then track skip", () => {
    const [fix] = conformCorrections(audit([line({ lag_ms: -2200 })]), [
      { id: "s1", analysis: analysis(), lane: "native", takeSeconds: 6 },
    ]);
    expect(fix?.reason).toBe("sync");
    expect(fix?.analysis.viseme_pad_seconds).toBe(0);
    expect(fix?.analysis.audio_skip_seconds).toBeCloseTo(1.9, 3);
    expect(fix?.analysis.conform?.passes).toBe(1);
  });

  it("delays an early voice with more pad", () => {
    const [fix] = conformCorrections(audit([line({ lag_ms: 250, limit_ms: 125 })]), [
      { id: "s1", analysis: analysis(), lane: "native", takeSeconds: 6 },
    ]);
    expect(fix?.analysis.viseme_pad_seconds).toBeCloseTo(0.55, 3);
    expect(fix?.analysis.audio_skip_seconds).toBe(0);
  });

  it("extends the settle for an unsettled open, moving picture and sound together", () => {
    const [fix] = conformCorrections(audit([line({ lag_ms: 10, pass: false, settled_open: false })], []), [
      { id: "s1", analysis: analysis({ audio_skip_seconds: 1.2 }), lane: "native", takeSeconds: 6 },
    ]);
    expect(fix?.reason).toBe("room_morph");
    expect(fix?.analysis.settle_in_seconds).toBeCloseTo(1.5, 3);
    expect(fix?.analysis.audio_skip_seconds).toBeCloseTo(1.5, 3);
  });

  it("refuses shifts larger than a mis-measure, TTS lanes, exhausted passes, and skips past the take", () => {
    const shots = [
      { id: "s1", analysis: analysis(), lane: "native" as const, takeSeconds: 6 },
      { id: "s2", analysis: analysis(), lane: "tts" as const, takeSeconds: 6 },
      { id: "s3", analysis: analysis({ conform: { passes: 2, shift_seconds: 1, last_lag_ms: 0 } }), lane: "native" as const, takeSeconds: 6 },
      { id: "s4", analysis: analysis({ audio_skip_seconds: 4 }), lane: "native" as const, takeSeconds: 6 },
    ];
    const fixes = conformCorrections(
      audit([
        line({ shot_id: "s1", lag_ms: -3500 }),
        line({ shot_id: "s2", lag_ms: -500 }),
        line({ shot_id: "s3", lag_ms: -500 }),
        line({ shot_id: "s4", lag_ms: -2000 }),
      ]),
      shots,
    );
    expect(fixes).toEqual([]);
  });

  it("only re-renders when every refusal is conformable", () => {
    const a = audit([line({ shot_id: "s1", lag_ms: -500 })]);
    const fixes = conformCorrections(a, [{ id: "s1", analysis: analysis(), lane: "native", takeSeconds: 6 }]);
    expect(onlyConformable(a, fixes)).toBe(true);
    expect(onlyConformable(audit([line({ shot_id: "s1", lag_ms: -500 })], ["loudness_off_target"]), fixes)).toBe(true);
    expect(onlyConformable(audit([line({ shot_id: "s1", lag_ms: -500 })], ["black_frames"]), fixes)).toBe(false);
    // An uncorrectable sync line does not veto the pass; a black frame does.
    expect(onlyConformable(audit([line({ shot_id: "s1", lag_ms: -500 }), line({ shot_id: "s9", lag_ms: null, voice_onset_s: null })]), fixes)).toBe(true);
    expect(onlyConformable(audit([line({ shot_id: "s1", lag_ms: -500 })]), [])).toBe(false);
  });
});
