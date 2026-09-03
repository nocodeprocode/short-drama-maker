import type { MuxAudit } from "../media/mux-audit.ts";
import type { TakeAnalysis } from "./take-analysis.ts";

/**
 * Sync conform: the post-house move of slipping a line onto the lips after
 * hearing the mix, done from the audit's own measurement on the dialogue stem.
 *
 * The take analysis places a line from a voice onset it measured on the raw
 * take. That onset can be wrong (a music swell, a breath, a word the STT
 * missed) and the mixed programme is where the truth shows. Rather than refuse
 * the cut and reshoot a take whose picture is fine, the audit's measured
 * voice-to-mouth delta is folded back into the shot's placement and the block
 * re-rendered; pure re-timing, no picture change:
 *
 *   voice late  (delta > 0): shorten the pad, then skip more of the track head
 *   voice early (delta < 0): lengthen the pad
 *
 * An unsettled open (room still morphing on the first frame) extends the settle
 * trim by the audit's own window, moving picture and audio together.
 */
export type SyncCorrection = {
  shot_id: string;
  reason: "sync" | "room_morph";
  delta_seconds: number;
  analysis: TakeAnalysis;
};

/** Larger than this and the take's onset is not a mis-measure, it is a different line. */
export const CONFORM_MAX_SHIFT_SECONDS = 3;
export const CONFORM_HEAD_EXTEND_SECONDS = 0.3;
export const CONFORM_MAX_SETTLE_SECONDS = 2.0;
export const CONFORM_MAX_PASSES = 2;

export function conformCorrections(
  audit: MuxAudit,
  shots: ReadonlyArray<{
    id: string;
    analysis: TakeAnalysis | null | undefined;
    lane: "native" | "tts" | "silent" | null | undefined;
    takeSeconds: number | null;
  }>,
): SyncCorrection[] {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  const out: SyncCorrection[] = [];
  for (const line of audit.lines) {
    if (line.pass) continue;
    const shot = byId.get(line.shot_id);
    if (!shot || !shot.analysis || shot.lane !== "native") continue;
    const passes = shot.analysis.conform?.passes ?? 0;
    if (passes >= CONFORM_MAX_PASSES) continue;

    let pad = Math.max(0, shot.analysis.viseme_pad_seconds ?? 0);
    let skip = Math.max(0, shot.analysis.audio_skip_seconds ?? 0);
    let settle = Math.max(0, shot.analysis.settle_in_seconds ?? 0);
    let shifted = 0;
    let reason: SyncCorrection["reason"] | null = null;

    // lag = mouth − voice; delta = voice − mouth, the amount the audio must move
    // earlier. Without a mouth measurement the gate was placement, so the delta
    // is voice against where the manifest put it.
    const measuredDelta =
      line.lag_ms != null
        ? Math.abs(line.lag_ms) > line.limit_ms
          ? -line.lag_ms / 1000
          : null
        : line.voice_onset_s != null
          ? line.voice_onset_s - line.expected_voice_s
          : null;
    if (measuredDelta != null && Math.abs(measuredDelta) * 1000 > line.limit_ms) {
      const delta = measuredDelta;
      if (Math.abs(delta) > CONFORM_MAX_SHIFT_SECONDS) continue;
      if (delta > 0) {
        const fromPad = Math.min(pad, delta);
        pad -= fromPad;
        skip += delta - fromPad;
      } else {
        pad += -delta;
      }
      shifted += delta;
      reason = "sync";
    }
    if (!line.settled_open && settle + CONFORM_HEAD_EXTEND_SECONDS <= CONFORM_MAX_SETTLE_SECONDS) {
      settle += CONFORM_HEAD_EXTEND_SECONDS;
      skip += CONFORM_HEAD_EXTEND_SECONDS;
      reason = reason ?? "room_morph";
    }
    if (!reason) continue;
    // The track must still have a head to play: never skip into the last half second.
    if (shot.takeSeconds != null && skip > shot.takeSeconds - 0.5) continue;

    out.push({
      shot_id: shot.id,
      reason,
      delta_seconds: Number(shifted.toFixed(3)),
      analysis: {
        ...shot.analysis,
        viseme_pad_seconds: Number(pad.toFixed(3)),
        audio_skip_seconds: Number(skip.toFixed(3)),
        settle_in_seconds: Number(settle.toFixed(3)),
        conform: {
          passes: passes + 1,
          shift_seconds: Number(((shot.analysis.conform?.shift_seconds ?? 0) + shifted).toFixed(3)),
          last_lag_ms: line.lag_ms,
        },
      },
    });
  }
  return out;
}

/** True when every refusal is one the conform loop can act on. */
export function onlyConformable(audit: MuxAudit, corrections: SyncCorrection[]): boolean {
  if (corrections.length === 0) return false;
  const fixable = new Set(corrections.map((row) => row.shot_id));
  return audit.reasons.every((reason) => {
    const [kind, id] = reason.split(":");
    return (kind === "sync" || kind === "room_morph") && id != null && fixable.has(id);
  });
}
