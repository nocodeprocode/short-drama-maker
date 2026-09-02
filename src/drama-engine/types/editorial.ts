export type EditMode = "locked_take" | "already_cut" | "coverage_single";

export type AudioRole = "onscreen" | "offscreen" | "two_shot_avoid" | "silent";

export type Eyeline = "left_of_camera" | "right_of_camera" | "down" | "lens_forbidden";

export type ShotFunction =
  | "hook_cu"
  | "accusation_cu"
  | "listener_hold"
  | "insert_evidence"
  | "doorway_reveal"
  | "slap_peak"
  | "reaction"
  | "phone_ui"
  | "stacked_two"
  | "establishing"
  | "button_cu"
  | "block_button"
  | "name_plant";

export type ContinuityKind = "weld" | "jump";

export type Continuity = {
  kind: ContinuityKind;
  prev_shot_id?: string;
  last_frame_asset_id?: string;
};

export type TransitionType = "cut" | "jcut" | "lcut" | "hold";

export const HOOK_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["hook_cu", "insert_evidence", "slap_peak"]);

export const BUTTON_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["button_cu", "doorway_reveal"]);

export const LICENSED_REACTION_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["reaction", "slap_peak"]);

export const OBJECT_INSERT_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["insert_evidence", "phone_ui"]);

export function allowsTwoShot(fn?: ShotFunction | null): boolean {
  return fn === "stacked_two" || fn === "establishing";
}

export function isWideCoverage(input: {
  function?: ShotFunction | null;
  type?: string | null;
  camera?: string | null;
}): boolean {
  if (input.function === "establishing" || input.function === "stacked_two") return true;
  if (input.type === "establishing") return true;
  return /\b(establishing|wide|banquet|lobby|estate|castle|two-shot|two shot|group)\b/i.test(
    input.camera ?? "",
  );
}

const OBJECT_PLATE_CAMERA =
  /\b(receipt|paper|pad|phone|note|handwritten|lock screen|sign-in|desk pad|water glass|unlabeled)\b/i;
const FACE_ON_CAMERA = /\b(face|eyes|jaw|brow|mouth|portrait)\b/i;

/** Hand / paper / phone plates that must not pull a character still. */
export function cameraIsObjectPlate(camera?: string | null): boolean {
  if (!camera) return false;
  return OBJECT_PLATE_CAMERA.test(camera) && !FACE_ON_CAMERA.test(camera);
}

export function isObjectInsert(input: {
  function?: ShotFunction | null;
  type?: string | null;
  dialogue?: string | null;
  camera?: string | null;
  audio_role?: string | null;
}): boolean {
  if (input.function === "name_plant") return false;
  // A line spoken on camera is a face, whatever the camera text says.
  if (input.dialogue && input.audio_role !== "offscreen" && input.audio_role !== "silent" && !(input.function && OBJECT_INSERT_FUNCTIONS.has(input.function))) {
    return false;
  }
  if (input.function && OBJECT_INSERT_FUNCTIONS.has(input.function)) return true;
  if (input.function === "hook_cu" && !input.dialogue) return true;
  if (input.type === "broll" && !input.dialogue) return true;
  return cameraIsObjectPlate(input.camera);
}
