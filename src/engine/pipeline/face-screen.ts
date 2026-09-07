import type { Shot } from "../domain.ts";
import type { VideoEngine } from "../ai/types.ts";

export type FaceScreenVerdict = "accepted" | "refused" | "error";

/** The provider's own words when it will not take a still as a reference. */
export function isPrivacyRefusal(message: string): boolean {
  return /InputImageSensitiveContentDetected|PrivacyInformation|may contain real person/i.test(message);
}

/**
 * Ask the video provider whether it will accept a face as a reference at all.
 *
 * Some generated faces read as a real person to the provider's classifier, and
 * nothing about the take changes that: the same still is refused alone, raw,
 * stamped, or stylised. A face that cannot be submitted cannot carry a series,
 * so it is worth one throwaway clip to find out before the shoot depends on it.
 * A refusal is rejected at submit and costs nothing; only a pass is billed.
 */
export async function screenFaceReference(input: {
  video: Pick<VideoEngine, "submit">;
  shot: Shot;
  model: string;
  referenceUrl: string;
  durationSeconds?: number;
}): Promise<{ verdict: FaceScreenVerdict; message: string | null }> {
  try {
    await input.video.submit({
      shot: input.shot,
      prompt: "A fictional character stands still in an empty room and blinks once. No text.",
      visual_reference_urls: [input.referenceUrl],
      audio_reference_url: null,
      duration_seconds: input.durationSeconds ?? 4,
      model: input.model,
      privacy_profile: "standard",
      callback_url: null,
    });
    return { verdict: "accepted", message: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { verdict: isPrivacyRefusal(message) ? "refused" : "error", message };
  }
}
