import { firstFrameKind } from "../media/face-crop.ts";

export type IdentityRefPolicy = "face_first" | "wardrobe_first" | "face_only";

/** face_only: CU still only. Kitchen/wardrobe plates overpower identity (teal cardigan / navy shirt). */
export const DEFAULT_IDENTITY_REF_POLICY: IdentityRefPolicy = "face_only";

export const CUT_BLOCKERS = new Set([
  "identity_drift",
  "duration_disaster",
  "insert_used_face_still",
  "first_frame_not_cu",
  "audio_missing",
  "not_portrait",
  "aspect_not_9_16",
  "black_frames",
  "decode_failed",
  "file_missing",
]);

export function resolveIdentityRefPolicy(override?: string | null): IdentityRefPolicy {
  const raw = (override ?? process.env.DRAMA_IDENTITY_REF_POLICY ?? DEFAULT_IDENTITY_REF_POLICY).trim();
  if (raw === "wardrobe_first") return "wardrobe_first";
  if (raw === "face_only") return "face_only";
  return "face_first";
}

export function orderIdentityRefs(input: {
  policy: IdentityRefPolicy;
  face?: { url: string; kind: string } | null;
  wardrobe?: { url: string; kind: string } | null;
}): { urls: string[]; first_frame_kind: ReturnType<typeof firstFrameKind>; first_kind: string | null } {
  const face = input.face?.url ? input.face : null;
  if (input.policy === "face_only") {
    return face
      ? { urls: [face.url], first_frame_kind: firstFrameKind(face.kind), first_kind: face.kind }
      : { urls: [], first_frame_kind: "face", first_kind: null };
  }
  const look = input.wardrobe?.url && input.wardrobe.url !== face?.url ? input.wardrobe : null;
  if (input.policy === "wardrobe_first" && look) {
    return {
      urls: face ? [look.url, face.url] : [look.url],
      first_frame_kind: firstFrameKind(look.kind),
      first_kind: look.kind,
    };
  }
  if (face) {
    return {
      urls: look ? [face.url, look.url] : [face.url],
      first_frame_kind: firstFrameKind(face.kind),
      first_kind: face.kind,
    };
  }
  if (look) {
    return {
      urls: [look.url],
      first_frame_kind: firstFrameKind(look.kind),
      first_kind: look.kind,
    };
  }
  return { urls: [], first_frame_kind: "face", first_kind: null };
}

export function cutEligible(reasons: string[] | null | undefined): boolean {
  return !(reasons ?? []).some((reason) => CUT_BLOCKERS.has(reason));
}

export function shouldRegenTake(input: {
  status: string;
  reasons?: string[] | null;
  alreadyRegenerated?: boolean;
  model?: string | null;
}): boolean {
  if (input.alreadyRegenerated) return false;
  if (input.status === "failed" || input.status === "cancelled") return true;
  const reasons = input.reasons ?? [];
  if (keepWanInternalCut(input.model, reasons)) return false;
  return !cutEligible(reasons);
}

/** Wan locked CUs often trip a false smash-cut. Mini failover invents a stranger — keep Wan. */
export function keepWanInternalCut(model: string | null | undefined, reasons: string[] | null | undefined): boolean {
  if (!model?.includes("wan")) return false;
  const blockers = (reasons ?? []).filter((reason) => reason !== "internal_cut");
  return (reasons ?? []).includes("internal_cut") && blockers.every((reason) => !CUT_BLOCKERS.has(reason));
}

export function shouldFailoverModel(model: string | null | undefined, reasons: string[] | null | undefined): boolean {
  if (model?.includes("wan")) return false;
  return !cutEligible(reasons);
}
