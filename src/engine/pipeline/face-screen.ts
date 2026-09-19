import type { Shot } from "../domain.ts";
import type { VideoEngine } from "../ai/types.ts";

export type FaceScreenVerdict = "accepted" | "refused" | "error";

export type CastLookVerdict = { pass: boolean; reasons: string[] };

/** FaceTime-close on a 9:16 still: head-and-shoulders or tighter. */
export const CAST_LOOK_FACE_MIN_HEIGHT = 0.18;

export const CAST_LOOK_PLAIN =
  /\b(average|plain|ordinary|tired|unremarkable|nondescript)\b/i;

/**
 * A lit-up or mismatched iris. The judge kept describing these in its own notes
 * — "heterochromatic glowing eyes" — while still passing the still, so a pack
 * locked with LED eyes on a human being. Read as a backstop to the eyes_natural
 * verdict, because the model volunteers the words even when it answers true.
 */
export const CAST_LOOK_EYE_DEFECT =
  /\b(?:heterochromia|heterochromatic|mismatched eyes?|different colou?red eyes?|one eye is (?:a )?different|neon eyes?|led eyes?|(?:glowing|luminous|self-lit|lit-up|backlit|incandescent) (?:eyes?|iris(?:es)?|pupils?)|(?:eyes?|iris(?:es)?|pupils?) (?:that )?(?:glow|glows|glowing|emit|emits|radiate|radiates))\b/i;

/**
 * The canonical pack style is "a plain warm-grey wall", so the judge describes
 * the backdrop as plain on every good still. Read as a plain FACE that rejected
 * clean stills and burned paid retries, so the backdrop sense is stripped first.
 */
const PLAIN_BACKDROP =
  /\bplain\b(?=(?:\s+[\w-]+){0,2}\s+(?:wall|walls|backdrop|background|surface|room|studio|canvas|grey|gray))/gi;

export function castLookFromFaceBox(box: { width: number; height: number } | null | undefined): string[] {
  if (!box) return ["face_missing"];
  if (box.height < CAST_LOOK_FACE_MIN_HEIGHT) return ["face_too_far"];
  return [];
}

export function castLookFromNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const reasons: string[] = [];
  if (CAST_LOOK_PLAIN.test(notes.replace(PLAIN_BACKDROP, " "))) reasons.push("face_plain");
  if (CAST_LOOK_EYE_DEFECT.test(notes)) reasons.push("eyes_unnatural");
  return reasons;
}

/**
 * Beauty gate for NEW character stills only. Old locked Mara/Cole PNGs are not
 * re-gated; the next generated still that is average or far cannot lock.
 */
export function screenCastLook(input: {
  faceBox?: { width: number; height: number } | null;
  notes?: string | null;
  /** Read even for a faithful likeness: a lit iris is wrong on any face. */
  eyeNotes?: string | null;
  beauty?: boolean | null;
  modest?: boolean | null;
  close?: boolean | null;
  eyesNatural?: boolean | null;
  checkDistance?: boolean;
}): CastLookVerdict {
  const reasons: string[] = [];
  if (input.checkDistance !== false) {
    if (input.close === false) reasons.push("face_too_far");
    else if (input.close !== true) reasons.push(...castLookFromFaceBox(input.faceBox));
  }
  reasons.push(...castLookFromNotes(input.notes));
  if (input.eyeNotes && CAST_LOOK_EYE_DEFECT.test(input.eyeNotes)) reasons.push("eyes_unnatural");
  if (input.eyesNatural === false) reasons.push("eyes_unnatural");
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
