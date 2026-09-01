import type { ShotPlanScene } from "../../engine/domain.ts";
import type { SilenceLicense } from "../types/pacing.ts";

type PlanShot = ShotPlanScene["shots"][number];

const SPIKE_HINT = /\b(slap|nuke|dna|luna|fired|heir|mark|clause|pregnant)\b/i;

export function licenseForShot(shot: PlanShot, prev?: PlanShot): SilenceLicense | null {
  if (shot.function === "button_cu") return "button_freeze";
  if (shot.function === "slap_peak" || shot.function === "reaction") {
    if (prev && SPIKE_HINT.test(`${prev.dialogue ?? ""} ${prev.emotion ?? ""}`)) return "post_slap";
    if (shot.function === "slap_peak") return "post_slap";
    return "post_nuke";
  }
  if (!shot.dialogue && (shot.duration_hint_seconds >= 4 || (shot.audio_role ?? "silent") === "silent")) {
    if (
      shot.type === "broll" ||
      shot.type === "establishing" ||
      shot.function === "insert_evidence" ||
      shot.function === "phone_ui" ||
      shot.function === "establishing" ||
      shot.function === "stacked_two"
    ) {
      return null;
    }
    return "illegal_opera";
  }
  return null;
}

export function consumeReactionPad(input: {
  needs_reaction_pad: boolean;
  shot: PlanShot;
  next?: PlanShot;
}): { shot: PlanShot; inserted?: PlanShot } {
  if (!input.needs_reaction_pad) return { shot: input.shot };
  if (input.next?.type === "reaction" || input.next?.function === "reaction") {
    return { shot: input.shot };
  }
  if (input.shot.function === "button_cu") {
    return {
      shot: {
        ...input.shot,
        duration_hint_seconds: Math.min(input.shot.duration_hint_seconds, 8),
      },
    };
  }
  const inserted: PlanShot = {
    type: "reaction",
    speaker: input.shot.speaker_on_camera ?? input.shot.speaker,
    dialogue: null,
    emotion: "the line lands",
    delivery: null,
    pace: null,
    camera: input.shot.camera,
    mouth_visibility_required: false,
    duration_hint_seconds: 2,
    hero: false,
    edit_mode: "locked_take",
    audio_role: "silent",
    speaker_on_camera: input.shot.speaker_on_camera ?? input.shot.speaker,
    speakers_off_camera: [],
    eyeline: "lens_forbidden",
    function: "reaction",
    silence_license: "post_nuke",
  };
  return { shot: input.shot, inserted };
}

export function silenceLegal(shot: PlanShot, prev?: PlanShot): boolean {
  const license = shot.silence_license ?? licenseForShot(shot, prev);
  if (shot.dialogue) return true;
  if (
    shot.function === "insert_evidence" ||
    shot.function === "phone_ui" ||
    shot.function === "establishing" ||
    shot.function === "stacked_two" ||
    shot.function === "name_plant" ||
    shot.type === "broll" ||
    shot.type === "establishing"
  ) {
    return shot.duration_hint_seconds <= 8;
  }
  if (license === "post_slap" || license === "post_nuke") {
    return shot.duration_hint_seconds >= 1.5 && shot.duration_hint_seconds <= 3;
  }
  if (license === "button_freeze") {
    return shot.duration_hint_seconds <= 3 || (shot.duration_hint_seconds <= 8 && Boolean(shot.dialogue));
  }
  return shot.duration_hint_seconds < 4;
}
