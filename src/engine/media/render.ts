import { sha256Hex, stableStringify } from "../crypto.ts";
import type { AlignmentTrack, RenderManifest } from "../domain.ts";
import { captionsAlongTimeline, captionsFromAlignment, cuesToVtt } from "../pipeline/captions.ts";
import { assembleEpisodeMp4 } from "./ffmpeg-mix.ts";

export type RenderInput = {
  manifest: RenderManifest;
  shotBodies: Uint8Array[];
  alignments: Array<AlignmentTrack | null | undefined>;
  ttsBodies?: Array<Uint8Array | null>;
  nativeAudio?: Array<Uint8Array | null>;
  heardLanes?: Array<"native" | "tts" | "silent" | null>;
  /** Per-shot measured values from take analysis; null lets the mixer probe. */
  visemePadSeconds?: Array<number | null | undefined>;
  visemeMouthOpenSeconds?: Array<number | null | undefined>;
  visemeVoiceOnsetSeconds?: Array<number | null | undefined>;
  /** Seedance scene takes keep the model's own picture+speech mux. */
  lockedNative?: boolean[];
  /** Pre-built cues; when set, alignments are not used for captions. */
  vtt?: string;
};

export type RenderOutput = {
  body: Uint8Array;
  checksum: string;
  vtt: string;
  container: "mp4";
  /** Dialogue-only stem (48 kHz WAV) on the same clock as `body`; null when the mixer had none. */
  dialogueStem?: Uint8Array | null;
};

export type RenderFn = (input: RenderInput) => Promise<RenderOutput>;

/**
 * Thrown when the mixer cannot produce a playable MP4. Callers must treat this
 * as a hard failure: no episode may be marked complete without real picture.
 */
export class RenderFailedError extends Error {
  constructor(readonly reason: string) {
    super(`Render failed: ${reason}`);
    this.name = "RenderFailedError";
  }
}

export function buildEpisodeVtt(input: Pick<RenderInput, "manifest" | "alignments">): string {
  const shotDurations = input.manifest.shots.map((shot) =>
    Math.max(0, shot.out_point_seconds - shot.in_point_seconds),
  );
  const aligned =
    input.alignments.length === input.manifest.shots.length
      ? captionsAlongTimeline({
          shotDurations,
          alignments: input.alignments,
          pictureStarts: input.manifest.shots.map((shot) => shot.picture_start_seconds),
          speakers: input.manifest.shots.map((shot) => shot.speaker),
          scripts: input.manifest.shots.map((shot) => shot.scene_script),
        })
      : input.alignments.flatMap((track) => (track ? captionsFromAlignment(track) : []));
  return cuesToVtt(aligned);
}

function isMp4(body: Uint8Array): boolean {
  return body.byteLength > 32 && body[4] === 0x66 && body[5] === 0x74 && body[6] === 0x79 && body[7] === 0x70;
}

export async function renderEpisodeBytes(input: RenderInput): Promise<RenderOutput> {
  if (input.shotBodies.length === 0) throw new RenderFailedError("no shots");
  if (input.shotBodies.length !== input.manifest.shots.length) {
    throw new RenderFailedError(
      `manifest has ${input.manifest.shots.length} shots but ${input.shotBodies.length} bodies were supplied`,
    );
  }
  const vtt = input.vtt ?? buildEpisodeVtt(input);
  let dialogueStem: Uint8Array | null = null;
  const mixed = await assembleEpisodeMp4({
    manifest: input.manifest,
    shotBodies: input.shotBodies,
    ttsBodies: input.ttsBodies,
    nativeAudio: input.nativeAudio,
    heardLanes: input.heardLanes,
    visemePadSeconds: input.visemePadSeconds,
    visemeMouthOpenSeconds: input.visemeMouthOpenSeconds,
    visemeVoiceOnsetSeconds: input.visemeVoiceOnsetSeconds,
    lockedNative: input.lockedNative,
    vtt,
    onDialogueStem: (stem) => {
      dialogueStem = stem;
    },
  });
  if (!mixed || !isMp4(mixed)) {
    throw new RenderFailedError(
      mixed ? "mixer returned bytes that are not an MP4" : "ffmpeg unavailable or every take was rejected by the mixer",
    );
  }
  return { body: mixed, checksum: await sha256Hex(mixed), vtt, container: "mp4", dialogueStem };
}

export function manifestFingerprint(manifest: RenderManifest): string {
  return stableStringify(manifest);
}
