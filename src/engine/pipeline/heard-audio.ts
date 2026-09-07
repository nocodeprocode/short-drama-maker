import type { HeardLane } from "../../drama-engine/types/audio.ts";
import { dialogueMatchesTranscript } from "./stt-qc.ts";

export async function chooseHeardLane(input: {
  dialogue: string | null | undefined;
  audioRole?: string | null;
  nativeTranscript?: string | null;
  hasNativeAudio?: boolean;
  /** Take was I2V'd with reference_audio / generate_audio — lips follow that file. */
  audioConditioned?: boolean;
  /** Seedance scene takes already carry the spoken scene; never substitute TTS. */
  sceneTake?: boolean;
}): Promise<HeardLane> {
  if (!input.dialogue?.trim()) return "silent";
  if (input.audioRole === "offscreen" || input.audioRole === "silent") return "tts";
  // Onscreen speech: play the audio that drove the mouth. Never lay dry TTS
  // over a take whose visemes were timed to a different file.
  if (input.sceneTake && input.hasNativeAudio) return "native";
  if (input.audioConditioned && input.hasNativeAudio) return "native";
  if (input.hasNativeAudio && input.nativeTranscript && dialogueMatchesTranscript(input.dialogue, input.nativeTranscript)) {
    return "native";
  }
  if (input.audioConditioned) return "silent";
  return "tts";
}

/** Onscreen dialogue must not J-cut before the picture (first viseme lives on the take). */
export function heardDelaySeconds(input: {
  pictureStartSeconds?: number | null;
  audioStartSeconds?: number | null;
  audioRole?: string | null;
  inPointSeconds?: number | null;
  leadingSilenceSeconds?: number | null;
  /** Silence padded at the head of heard audio so voice does not beat the mouth. */
  visemePadSeconds?: number | null;
}): number {
  const picture = Math.max(0, input.pictureStartSeconds ?? input.audioStartSeconds ?? 0);
  const onscreen = !input.audioRole || input.audioRole === "onscreen";
  const visemePad = Math.max(0, input.visemePadSeconds ?? 0);
  if (onscreen) {
    const skip = Math.max(0, input.inPointSeconds ?? 0);
    const handle = Math.max(0, input.leadingSilenceSeconds ?? 0);
    // Native is trimmed by the same in-point as picture (skip applied to the file).
    // TTS handles must not play before the mouth: delay by leftover handle after in-point.
    const handleLead = Math.max(0, handle - skip);
    return picture + handleLead + visemePad;
  }
  return Math.max(0, input.audioStartSeconds ?? picture) + visemePad;
}

/** Seconds to drop from the start of the heard file so it matches picture in-point. */
export function heardFileSkipSeconds(input: {
  lane: HeardLane;
  inPointSeconds?: number | null;
  leadingSilenceSeconds?: number | null;
}): number {
  if (input.lane === "silent") return 0;
  if (input.lane === "native") return Math.max(0, input.inPointSeconds ?? 0);
  return Math.max(0, input.leadingSilenceSeconds ?? 0);
}
