export type EditMode = "locked_take" | "already_cut" | "coverage_single" | "scene_take";

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
  | "name_plant"
  | "scene_take";

export type ContinuityKind = "weld" | "jump";

export type Continuity = {
  kind: ContinuityKind;
  prev_shot_id?: string;
  last_frame_asset_id?: string;
  /** Vision note from the last frame: sides, gesture, prop place. */
  blocking_note?: string;
};

export type TransitionType = "cut" | "jcut" | "lcut" | "hold" | "fade";

export const HOOK_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["hook_cu", "insert_evidence", "slap_peak"]);

export const BUTTON_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["button_cu", "doorway_reveal"]);

export const LICENSED_REACTION_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["reaction", "slap_peak"]);

export const OBJECT_INSERT_FUNCTIONS: ReadonlySet<ShotFunction> = new Set(["insert_evidence", "phone_ui"]);

export function allowsTwoShot(fn?: ShotFunction | null): boolean {
  return fn === "stacked_two" || fn === "establishing" || fn === "scene_take";
}

export function isSceneTake(input: { function?: ShotFunction | string | null; edit_mode?: string | null }): boolean {
  return input.edit_mode === "scene_take" || input.function === "scene_take";
}

/**
 * Native speech that must be measured. A scene take speaks even when the
 * planner left `dialogue` empty and only wrote `scene_script` — skipping STT
 * or the face box there lets name-leak and JOIN CUT pass in silence.
 */
export function spokenTakeNeedsMeasure(input: {
  edit_mode?: string | null;
  function?: ShotFunction | string | null;
  type?: string | null;
  dialogue?: string | null;
  camera?: string | null;
  audio_role?: string | null;
}): boolean {
  if (isSceneTake(input)) return true;
  return (
    Boolean(input.dialogue) &&
    input.audio_role !== "offscreen" &&
    input.audio_role !== "silent" &&
    !isObjectInsert(input)
  );
}

/** 0-based episode take index. Per-scene `position` resets and must not drive JOIN CUT. */
export function sceneTakeIndexOf(
  shot: { id?: string },
  episodeShots: ReadonlyArray<{
    id?: string;
    edit_mode?: string | null;
    function?: string | null;
    shot_data?: { edit_mode?: string | null; function?: string | null };
  }>,
): number {
  const dataOf = (row: (typeof episodeShots)[number]) => row.shot_data ?? row;
  return episodeShots.filter((row) => isSceneTake(dataOf(row))).findIndex((row) => row.id === shot.id);
}

export function expectedFacesFor(input: {
  function?: ShotFunction | string | null;
  type?: string | null;
  edit_mode?: string | null;
  dialogue?: string | null;
  group_still_asset_id?: string | null;
  blocking?: { coverage?: string | null; present?: string[] | null } | null;
}): number | null {
  const fn = (input.function ?? null) as ShotFunction | null;
  if (isObjectInsert({ ...input, function: fn })) return null;
  const emptyWide =
    (fn === "establishing" || input.type === "establishing") &&
    !input.dialogue &&
    !input.group_still_asset_id;
  if (emptyWide) return 0;
  if (isSceneTake(input)) {
    const present = input.blocking?.present?.length ?? 0;
    return present >= 1 ? Math.min(3, present) : 2;
  }
  if (allowsTwoShot(fn) && Boolean(input.group_still_asset_id)) return 2;
  return 1;
}

export function isWideCoverage(input: {
  function?: ShotFunction | null;
  type?: string | null;
  camera?: string | null;
  edit_mode?: string | null;
}): boolean {
  if (isSceneTake(input)) return false;
  if (input.function === "establishing" || input.function === "stacked_two") return true;
  if (input.type === "establishing") return true;
  return /\b(establishing(?:\s+wide)?|empty wide|wide of the)\b/i.test(input.camera ?? "");
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
  function?: ShotFunction | string | null;
  type?: string | null;
  dialogue?: string | null;
  camera?: string | null;
  audio_role?: string | null;
}): boolean {
  const fn = input.function as ShotFunction | null | undefined;
  if (fn === "name_plant") return false;
  // A line spoken on camera is a face, whatever the camera text says.
  if (input.dialogue && input.audio_role !== "offscreen" && input.audio_role !== "silent" && !(fn && OBJECT_INSERT_FUNCTIONS.has(fn))) {
    return false;
  }
  if (fn && OBJECT_INSERT_FUNCTIONS.has(fn)) return true;
  if (fn === "hook_cu" && !input.dialogue) return true;
  if (input.type === "broll" && !input.dialogue) return true;
  return cameraIsObjectPlate(input.camera);
}
