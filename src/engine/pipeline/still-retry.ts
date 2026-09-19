/**
 * Turns a gate rejection into the correction the next attempt should read.
 *
 * Every retry used to be told the same thing — that production equipment was
 * visible — so a still rejected for a lit iris or for facing the camera when it
 * was asked to turn spent four more paid attempts fixing a lamp that was never
 * there. The reason is already in the thrown CAST_LOOK message; this hands it
 * back to the image model in words it can act on.
 */
export function stillRetryNote(message: string | null | undefined): string {
  if (!message) return "";
  const reasons = String(message);
  const lines: string[] = [];
  if (/production_gear/i.test(reasons)) {
    lines.push(
      "the last attempt showed production equipment. Every corner and edge must contain only the plain wall — no bright disc, lamp head, pole, stand, tripod, fixture, cable, backdrop edge, or photographic object.",
    );
  }
  if (/eyes_unnatural/i.test(reasons)) {
    lines.push(
      "the last attempt had lit-up eyes. Paint the irises as matte, ordinary, everyday colour, both eyes the same colour, darker than the lit skin, and let them fall into shadow with the rest of the face. No glow, no neon, no backlit iris, no bright patch on one eye.",
    );
  }
  if (/pose_mismatch/i.test(reasons)) {
    lines.push(
      "the last attempt did not turn the head far enough and repeated the reference's angle. Turn the head as the POSE line demands and judge it by how many eyes the camera can see, not by where the subject looks.",
    );
  }
  if (/face_too_far|face_missing/i.test(reasons)) {
    lines.push("the last attempt framed the face too small. Come closer: the face fills the frame, cropped at the chest.");
  }
  if (/face_plain/i.test(reasons)) {
    lines.push("the last attempt read as plain or tired. Make the face strikingly beautiful and camera-ready.");
  }
  if (/modest_dress/i.test(reasons)) {
    lines.push("the last attempt was underdressed. Opaque cloth to the throat, or a closed jacket over a buttoned shirt.");
  }
  if (lines.length === 0) return "";
  return `RETRY CORRECTION: ${lines.join(" Also, ")}`;
}
