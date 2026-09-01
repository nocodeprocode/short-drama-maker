import { HEAD_HANDLE_SECONDS, TAIL_HANDLE_SECONDS } from "../config/models.ts";
import type { VideoRoute } from "../domain.ts";

export type DurationDecision = {
  duration_seconds: number;
  needs_reaction_pad: boolean;
  raw_seconds: number;
};

export function finalizeShotDuration(input: {
  wavSeconds: number;
  route: Pick<VideoRoute, "min_duration_seconds" | "max_duration_seconds">;
  headHandle?: number;
  tailHandle?: number;
}): DurationDecision {
  const head = input.headHandle ?? HEAD_HANDLE_SECONDS;
  const tail = input.tailHandle ?? TAIL_HANDLE_SECONDS;
  const raw = input.wavSeconds + head + tail;

  if (raw < input.route.min_duration_seconds) {
    return {
      duration_seconds: input.route.min_duration_seconds,
      needs_reaction_pad: true,
      raw_seconds: raw,
    };
  }

  return {
    duration_seconds: Math.min(raw, input.route.max_duration_seconds),
    needs_reaction_pad: false,
    raw_seconds: raw,
  };
}
