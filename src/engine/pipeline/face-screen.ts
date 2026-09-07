import type { Shot } from "../domain.ts";
import type { VideoEngine } from "../ai/types.ts";

export type FaceScreenVerdict = "accepted" | "refused" | "error";

export type CastLookVerdict = { pass: boolean; reasons: string[] };

/** FaceTime-close on a 9:16 still: head-and-shoulders or tighter. */
export const CAST_LOOK_FACE_MIN_HEIGHT = 0.18;

export const CAST_LOOK_PLAIN =
  /\b(average|plain|ordinary|tired|unremarkable|nondescript)\b/i;

export function castLookFromFaceBox(box: { width: number; height: number } | null | undefined): string[] {
  if (!box) return ["face_missing"];
  if (box.height < CAST_LOOK_FACE_MIN_HEIGHT) return ["face_too_far"];
  return [];
}

export function castLookFromNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return CAST_LOOK_PLAIN.test(notes) ? ["face_plain"] : [];
}

/**
 * Beauty gate for NEW character stills only. Old locked Mara/Cole PNGs are not
 * re-gated; the next generated still that is average or far cannot lock.
 */
export function screenCastLook(input: {
  faceBox?: { width: number; height: number } | null;
  notes?: string | null;
  beauty?: boolean | null;
  modest?: boolean | null;
  close?: boolean | null;
  checkDistance?: boolean;
}): CastLookVerdict {
  const reasons: string[] = [];
  if (input.checkDistance !== false) {
    if (input.close === false) reasons.push("face_too_far");
    else if (input.close !== true) reasons.push(...castLookFromFaceBox(input.faceBox));
  }
  reasons.push(...castLookFromNotes(input.notes));
  if (input.beauty === false) reasons.push("face_plain");
  if (input.modest === false) reasons.push("modest_dress");
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)] };
}

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
