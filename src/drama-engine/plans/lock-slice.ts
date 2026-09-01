import type { EpisodePlan, ShotFunction, ShotPlanScene } from "../../engine/domain.ts";

type PlanShot = ShotPlanScene["shots"][number];

/**
 * Kitchen-only proof plan in the v9 grammar: one locked CU still per speaker,
 * `NAME: line` captions carry identity (no name-plant stills), wides are empty
 * rooms only, and there is no two-shot because two-shots invent people.
 */
export function kitchenLockPlan(names: { lead: string; wall: string; witness: string }): EpisodePlan {
  const { lead, wall, witness } = names;
  const loc = "night kitchen — marble island, under-cabinet key light, city windows";
  const wallFirst = wall.split(/\s+/)[0] ?? wall;
  const tagged = (
    fn: ShotFunction,
    shot: Omit<PlanShot, "function" | "emotion" | "delivery" | "pace" | "mouth_visibility_required" | "edit_mode" | "eyeline" | "block_index"> &
      Partial<Pick<PlanShot, "emotion" | "delivery" | "pace" | "mouth_visibility_required" | "eyeline">>,
  ): PlanShot => ({
    emotion: null,
    delivery: null,
    pace: null,
    mouth_visibility_required: false,
    edit_mode: "locked_take",
    eyeline: "lens_forbidden",
    block_index: 0,
    ...shot,
    function: fn,
  });
  return {
    title: "Tuesday in the kitchen",
    hook: "The Tuesday paper is already on the island.",
    conflict: "Eli says he did not write it. Mara will not drop whose name is on it.",
    cliffhanger: "If it is not Eli Hart, who signed Tuesday?",
    scenes: [
      {
        location: loc,
        time: "night",
        characters: [lead, wall, witness],
        shots: [
          tagged("hook_cu", {
            type: "broll",
            speaker: null,
            speaker_on_camera: null,
            dialogue: null,
            camera: "insert of unlabeled paper on marble, handwritten TUESDAY only, no people",
            duration_hint_seconds: 4,
            audio_role: "silent",
            sfx: "paper",
          }),
          tagged("establishing", {
            type: "establishing",
            speaker: null,
            speaker_on_camera: null,
            dialogue: null,
            camera: `establishing wide of ${loc}, empty island, no faces`,
            duration_hint_seconds: 6,
            audio_role: "silent",
            camera_move: "slow push",
          }),
          tagged("accusation_cu", {
            type: "dialogue",
            speaker: lead,
            speaker_on_camera: lead,
            dialogue: `${wallFirst}, look at Tuesday.`,
            emotion: "hot",
            delivery: "pressing",
            pace: "fast",
            camera: `medium close-up on ${lead}, ivory turtleneck, X-scar, same kitchen key light`,
            mouth_visibility_required: true,
            duration_hint_seconds: 6,
            audio_role: "onscreen",
            eyeline: "left_of_camera",
          }),
          tagged("accusation_cu", {
            type: "dialogue",
            speaker: wall,
            speaker_on_camera: wall,
            dialogue: "I did not write the paper.",
            emotion: "stunned",
            delivery: "fast",
            pace: "fast",
            camera: `medium close-up on ${wall}, charcoal henley, same kitchen grade`,
            mouth_visibility_required: true,
            duration_hint_seconds: 5,
            audio_role: "onscreen",
            eyeline: "right_of_camera",
            sfx: "comic",
            comic_sting: true,
          }),
          tagged("reaction", {
            type: "reaction",
            speaker: wall,
            speaker_on_camera: wall,
            dialogue: null,
            emotion: "the line lands",
            camera: `medium close-up on ${wall}, charcoal henley, mouth closed`,
            duration_hint_seconds: 2.5,
            audio_role: "silent",
            silence_license: "post_nuke",
            eyeline: "down",
          }),
          tagged("insert_evidence", {
            type: "broll",
            speaker: null,
            speaker_on_camera: null,
            dialogue: null,
            emotion: "stun",
            camera: "insert of unlabeled paper, handwritten TUESDAY, no people",
            duration_hint_seconds: 4,
            audio_role: "silent",
            sfx: "paper",
            comic_sting: true,
          }),
          tagged("accusation_cu", {
            type: "dialogue",
            speaker: lead,
            speaker_on_camera: lead,
            dialogue: "Then say who signed Tuesday.",
            emotion: "pressing",
            delivery: "quiet",
            pace: "slow",
            camera: `medium close-up on ${lead}, ivory, same kitchen`,
            mouth_visibility_required: true,
            duration_hint_seconds: 5,
            audio_role: "onscreen",
            eyeline: "left_of_camera",
          }),
          tagged("button_cu", {
            type: "dialogue",
            speaker: lead,
            speaker_on_camera: lead,
            dialogue: "If it is not Eli Hart, who signed Tuesday?",
            emotion: "unpaid",
            delivery: "quiet",
            pace: "slow",
            camera: `medium close-up on ${lead}, ivory turtleneck, hold`,
            mouth_visibility_required: true,
            duration_hint_seconds: 6,
            audio_role: "onscreen",
            eyeline: "left_of_camera",
          }),
        ],
      },
    ],
  };
}
