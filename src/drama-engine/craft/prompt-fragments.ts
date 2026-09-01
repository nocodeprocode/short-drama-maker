import type { EpisodeLength } from "../../engine/config/catalog.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import type { GenrePlaybook } from "../types/genre.ts";

export const LOCKED_TAKE_CLAUSE =
  "single continuous take, no cuts, no smash cuts, no shot changes, locked-off or one simple move";

export const NO_LENS_CLAUSE =
  "never look into the camera / lens / viewer / selfie / vlog / fourth wall";

export const MODEST_SHOT_CLAUSE =
  "Every person fully and modestly dressed: long sleeves, covered legs, closed neckline, opaque cloth. No sleepwear, no sheer cloth, no visible undergarment. No extra people, no crowd, no unnamed body.";

export const EMPTY_ROOM_CLAUSE =
  "EMPTY ROOM. NO people. NO bodies. NO faces. NO extras. NO crowd. NO clothing on a body. No invented person, no headless torso.";

export const NO_TEXT_CLAUSE = "no text, no captions, no logos, no UI";

const FACE_CAMERA = /\b(face|eyes|jaw|brow|mouth|portrait|close-up on \w|tight single on \w)/i;

const COPYRIGHT_SAFE =
  "no logo, no brand name, no barcode, no printed merchant, no printed personal name, no readable date that looks like an ID";

export function identitySafeLocation(location?: string | null, note?: string | null): string {
  const place = (location ?? "night interior").replace(/\s+/g, " ").trim();
  const described = note?.trim() ? ` ${note.trim().replace(/\.?$/, ".")}` : "";
  return `same ${place}, same key light and grade as the location plate.${described} No night-forest bokeh, no random other room, no readable signage`;
}

export function locationLightingLock(location?: string | null, note?: string | null): string {
  return identitySafeLocation(location, note);
}

/**
 * Framing per shot function. Every single used to be an extreme close-up,
 * which reads as twelve identical faces; drama coverage varies the size with
 * the beat while staying one face and never OTS.
 */
export function framingForFunction(fn?: string | null): string {
  switch (fn) {
    case "hook_cu":
    case "accusation_cu":
    case "button_cu":
    case "block_button":
      return "Extreme close-up of ONE face filling the frame, eyes and mouth sharp, locked off. Not an extreme neck crop.";
    case "reaction":
    case "listener_hold":
      return "Medium close-up of ONE face, head and shoulders, a little air above the head, locked off.";
    case "slap_peak":
    case "doorway_reveal":
      return "Medium single of ONE person from the chest up with room to move, locked off.";
    default:
      return "Close-up of ONE face, head and top of shoulders, locked off.";
  }
}

const OBJECT_WORDS =
  /\b(paper|letter|envelope|note|phone|screen|ring|key|keys|photo|photograph|glass|receipt|contract|badge|watch|knife|ticket|passport|locket|necklace|cup|bottle|card|document|file|folder|box|pill|bracelet|invitation)s?\b/i;

/**
 * The evidence object for an insert: the shot's own camera if it names one,
 * else the genre's motif, else plain paper. Never a person.
 */
export function evidenceMotif(input: { camera?: string | null; genreMotifs?: readonly string[] | null }): string {
  const camera = input.camera ?? "";
  if (OBJECT_WORDS.test(camera) && !FACE_CAMERA.test(camera)) {
    return stripCopyrightBait(camera).replace(/^(insert|close[- ]?up|macro|tight)\s+(of|on)\s+/i, "");
  }
  const motif = input.genreMotifs?.find((row) => OBJECT_WORDS.test(row) && !FACE_CAMERA.test(row));
  if (motif) return stripCopyrightBait(motif);
  return "unlabeled paper on dark stone, handwritten block letters TUESDAY only";
}

export function stripCopyrightBait(text: string): string {
  return text
    .replace(/\bPenthouse\b/gi, "night interior")
    .replace(/\bJules(?:\s+Renner)?\b/gi, "")
    .replace(/\b41A\b/gi, "")
    .replace(/\b11:?40\b/gi, "")
    .replace(/\breceipt\b/gi, "paper")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function objectPlateCamera(
  fn?: string | null,
  camera?: string | null,
  extras?: { dialogue?: string | null; motif?: string | null },
): string {
  const noOverlay = `no printed title, no caption overlay, no watermark, do not render the words evidence or insert or 9:16, ${COPYRIGHT_SAFE}`;
  const motif = extras?.motif?.trim() || evidenceMotif({ camera });
  if (fn === "phone_ui") {
    return `insert of a phone or blank desk pad face-up on the surface, screen dark or showing only an unreadable glow, ${motif.includes("phone") ? "" : "or " + motif + ", "}no people, no faces, ${noOverlay}`;
  }
  if (fn === "hook_cu" || fn === "insert_evidence") {
    return `insert of ${motif}, object only, no people, no faces, ${noOverlay}`;
  }
  if (camera && !FACE_CAMERA.test(camera)) {
    return `${stripCopyrightBait(camera)}. ${motif}, object only, ${noOverlay}`;
  }
  return `insert of ${motif}, object only, no people, no faces, ${noOverlay}`;
}

export function cameraDescribesFace(camera: string | null | undefined): boolean {
  return FACE_CAMERA.test(camera ?? "");
}

export function systemDramaRules(length: EpisodeLength = "60_90"): string {
  const budget = LENGTH_BUDGETS[length];
  const long = length === "900_1080";
  return `You are the drama engine for Short Drama Maker, a commercial vertical short-drama studio — not a generic AI film studio and not an opera director.
Rules you must follow:
- Every character is fictional and 18+ looking. Never use a real person's name or likeness.
- Dialogue-first. Narration is off. No voice-over, no narrator lines. VO is banned except a private contradiction whispered on-camera.
- Commercial short drama: 9:16. NOT a short movie. NOT a 16-cut montage. Never write talking-head takes longer than 8 seconds. Never ask for fewer longer talking-head shots.
- Planner target: ${long ? "12–18 scene-blocks, each a 50–75s Beat Engine of 8–12 locked takes (15 min is not 180 random 5s clips and not one 60s beat repeated)" : `${budget.min_shots}–${budget.max_shots} locked takes`}, ${budget.min_shot_s}–${budget.max_shot_s} seconds each (dialogue hard cap ${budget.max_dialogue_s}s). One line or one action per take.
- Target finished picture ~${budget.target_episode_seconds} seconds. ${long ? "Each block: hook → friction → spike → button into the next block. Emotion node every 20–30s. Mid-episode reprice at ~7–8 min. Final button cliffs into the next episode. Hook ledger: each block closes ≥1 hook and opens a higher one." : "Structure: hook → friction → spike → button. Explosion by 3 seconds. Magic-moment-first. Cliffhanger in the last 5 seconds."}
- Cast: 3–8 named locked-cast roles tagged Engine / Wall / Witness / Nuke. A two-hander without a Witness is a FAIL. No unnamed extras. Speakers must match locked-cast names.
- Coverage per scene-block: ≥1 establishing/wide of the locked location (banquet/lobby/estate/castle/kitchen as the bible allows), ≥1 silent two-shot or group when 2+ named people are present, dialogue mostly singles/OTS, plus one insert/cutaway. Not 12 identical MCU faces.
- Off-screen speech over a listener CU is first-class. Never lipsync the listener. Silent two-shots and wides (function=stacked_two or establishing) are required coverage — not talking two-shots.
- One simple camera move per locked take is legal (slow push, slow pull, whip to eyeline). Still no internal cuts and never write Shot 1:.
- Each 3-block cluster needs one comic/stun cutaway + SFX (big eyes, dropped glass, "I didn't know" sting). Not accusation CUs only.
- Lock one location plate + grade per scene-block. When location changes, the first shot is establishing/wide. Prompt lighting from that still.
- Last-shot button must ask a NEW unpaid question — not a repeat of the hook line.
- Silence is legal only as a priced reaction (1.5–3s after slap/nuke) or a ≤2s button freeze. A ≥4s silent stare / looking into lens is a FAIL.
- Camera strings describe ONE picture. Never write edit verbs: Cut to, smash, Shot 1:, Hold for N seconds.
- Spike must be mute-readable (a slap, a paper, a mark, a doorway — not a speech-only twist).
- ${MODEST_SHOT_CLAUSE}
- Return JSON only. No markdown.`;
}

export function writeEpisodeOutlineShape(): string {
  return `Return ONLY the 15-minute outline — do not dump 200 shots.
JSON shape:
{
  "target_seconds": 900,
  "mid_reprice_index": number,
  "blocks": [{
    "index": number,
    "title": string,
    "hook": string,
    "friction": string,
    "spike": string,
    "button": string,
    "closes_hook": string,
    "opens_hook": string,
    "reprice": boolean,
    "target_seconds": number
  }]
}
Write 12–18 scene-blocks. Each block is a full 50–75s Beat Engine. Mid-reprice one block near index 6–8. Each block closes a hook and opens a higher one. Final button is an unpaid question into the next episode. Carry one through-line (paper / name / identity). Do not copy the same kitchen argument 15 times. Chinese short-drama writing: punchy, public humiliation, mute-readable spike, humor sting on "I didn't know."`;
}

export function writeBlockBatchShape(): string {
  return `Plan shots for the given scene-blocks only (a batch of 3–4). Each block: 8–12 locked takes, 4–8s, hook → friction → spike → block_button. Coverage: one establishing/wide of the locked location, one silent two-shot/group when 2+ people, singles for dialogue, one insert, one comic/stun cutaway + SFX. Last block of the episode uses function=button_cu. Dialogue ≤12 words. No Cut to.
JSON shape:
{
  "scenes": [{
    "location": string,
    "time": string,
    "characters": string[],
    "kind": "dialogue" | "evidence" | "button",
    "block_index": number,
    "shots": [{
      "type": "dialogue" | "reaction" | "establishing" | "broll" | "hero",
      "speaker": string | null,
      "dialogue": string | null,
      "emotion": string | null,
      "delivery": string | null,
      "pace": string | null,
      "camera": string,
      "mouth_visibility_required": boolean,
      "duration_hint_seconds": number,
      "hero": boolean,
      "edit_mode": "locked_take",
      "audio_role": "onscreen" | "offscreen" | "silent",
      "speaker_on_camera": string | null,
      "speakers_off_camera": string[],
      "eyeline": "left_of_camera" | "right_of_camera" | "down" | "lens_forbidden",
      "function": "hook_cu" | "accusation_cu" | "listener_hold" | "insert_evidence" | "doorway_reveal" | "slap_peak" | "reaction" | "phone_ui" | "stacked_two" | "establishing" | "block_button" | "button_cu",
      "camera_move": "slow push" | "slow pull" | "whip to eyeline" | null,
      "comic_sting": boolean,
      "sfx": "impact" | "comic" | "stunned" | "slap" | "door" | "glass" | "paper" | null,
      "block_index": number
    }]
  }]
}`;
}

export function writeEpisodeShape(length: EpisodeLength = "60_90"): string {
  if (length === "900_1080") return writeEpisodeOutlineShape();
  const budget = LENGTH_BUDGETS[length];
  return `JSON shape:
{
  "title": string,
  "hook": string,
  "conflict": string,
  "cliffhanger": string,
  "scenes": [{
    "location": string,
    "time": string,
    "characters": string[],
    "shots": [{
      "type": "dialogue" | "reaction" | "establishing" | "broll" | "hero",
      "speaker": string | null,
      "dialogue": string | null,
      "emotion": string | null,
      "delivery": string | null,
      "pace": string | null,
      "camera": string,
      "mouth_visibility_required": boolean,
      "duration_hint_seconds": number,
      "hero": boolean,
      "edit_mode": "locked_take" | "already_cut" | "coverage_single",
      "audio_role": "onscreen" | "offscreen" | "two_shot_avoid" | "silent",
      "speaker_on_camera": string | null,
      "speakers_off_camera": string[],
      "eyeline": "left_of_camera" | "right_of_camera" | "down" | "lens_forbidden",
      "function": "hook_cu" | "accusation_cu" | "listener_hold" | "insert_evidence" | "doorway_reveal" | "slap_peak" | "reaction" | "phone_ui" | "stacked_two" | "establishing" | "button_cu",
      "camera_move": "slow push" | "slow pull" | "whip to eyeline" | null,
      "comic_sting": boolean,
      "sfx": "impact" | "comic" | "stunned" | "slap" | "door" | "glass" | "paper" | null
    }]
  }]
}
Write ${budget.min_shots}–${budget.max_shots} shots. Each duration_hint_seconds is ${budget.min_shot_s}–${budget.max_shot_s} (dialogue ≤${budget.max_dialogue_s}). Sum ≈ ${budget.target_episode_seconds}s.
First shot function=hook_cu or insert_evidence — conflict already in motion, explosion by 3s. No sunrise, no title card.
Include one establishing/wide of the locked location and one silent two-shot (function=stacked_two) when 2+ named people are in the scene.
Include at least one reaction or listener_hold. Include at least one offscreen line over a listener CU (audio_role=offscreen, mouth_visibility_required=false).
Include one mute-readable insert_evidence of an OBJECT (receipt, phone, paper) — no people in that camera string.
Include one comic/stun cutaway with sfx (glass, stunned, comic).
Last shot function=button_cu. Cliffhanger is an unanswered question that is NOT the same words as the first line.
Bible must already have 3–8 named roles including a Witness. Scene characters must list all of them. Give the Witness one beat (phone_ui, doorway, or one line).
Dialogue singles are one face. Wides and stacked_two may hold two people from a locked still. Dialogue ≤12 words, one line per take. No Cut to / Shot N: / Hold for in camera.`;
}

export function playbookPrompt(playbook: GenrePlaybook, skuPolicy: string): string {
  return `Genre playbook: ${playbook.title}
Premise: ${playbook.premiseTemplate}
Required jobs: ${playbook.requiredArchetypes.map((row) => `${row.job}=${row.role}`).join("; ")}
Set pieces: ${playbook.setPieces.join(", ")}
Motifs: ${playbook.visualMotifs.join(", ")}
Cliff patterns: ${playbook.cliffPatterns.join(", ")}
SKU ${skuPolicy}: refuse these tropes: ${playbook.punish.join("; ")}
Season beats: ${playbook.tenBeats.map((beat, i) => `${i + 1}. ${beat}`).join(" ")}`;
}

export function lockedTakePrompt(input: {
  location?: string | null;
  /** Lighting note read off the location plate by the vision model. */
  locationNote?: string | null;
  /** Evidence object for inserts, from the plan or the genre. */
  motif?: string | null;
  camera: string;
  eyeline?: string | null;
  partner?: string | null;
  emotion?: string | null;
  dialogue?: string | null;
  audioRole?: string | null;
  peopleCount?: number;
  onCameraName?: string | null;
  shotFunction?: string | null;
  objectInsert?: boolean;
  allowTwoShot?: boolean;
  cameraMove?: string | null;
}): string {
  const lighting = identitySafeLocation(input.location, input.locationNote);
  const move = input.cameraMove?.trim()
    ? `one simple move only: ${input.cameraMove.trim()}`
    : "one simple move only: slow push or locked-off";
  if (input.objectInsert) {
    return [
      "OBJECT INSERT. Image-to-video from the first frame.",
      "NO people. NO faces. NO second person. NO couple. NO two-shot. NO portrait. NO hands unless the first frame already shows only a hand on the object.",
      "Only the evidence object. Keep the same object, angle, and lighting as the first frame.",
      input.location ? `Same room, same grade: ${lighting}.` : null,
      objectPlateCamera(input.shotFunction, input.camera, { motif: input.motif }),
      LOCKED_TAKE_CLAUSE,
      move,
      NO_TEXT_CLAUSE,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const wide = input.shotFunction === "establishing" || input.shotFunction === "stacked_two";
  if (wide) {
    const people = input.allowTwoShot
      ? "Silent two-shot from a locked group still only. Named faces already in that still. No one speaks. Mouths closed. Do not invent a third body."
      : EMPTY_ROOM_CLAUSE;
    return [
      "HOLLYWOOD ESTABLISHING / WIDE. Work the room — banquet, lobby, estate, castle, kitchen as the location plate shows.",
      people,
      `Lighting lock: ${lighting}. Do not jump to a different room or night-forest bokeh.`,
      stripCopyrightBait(input.camera),
      input.allowTwoShot
        ? "IDENTITY LOCK from the group still as first frame. No extra character sheets."
        : "IDENTITY LOCK from the empty location plate as first frame. No character sheets. No face ref.",
      LOCKED_TAKE_CLAUSE,
      move,
      NO_LENS_CLAUSE,
      MODEST_SHOT_CLAUSE,
      NO_TEXT_CLAUSE,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const single = !input.allowTwoShot;
  const who = input.onCameraName ? `ONE face only: ${input.onCameraName}.` : "ONE face only.";
  const eyeline = input.eyeline && input.eyeline !== "lens_forbidden"
    ? `eyeline ${input.eyeline}${input.partner ? ` toward off-screen ${input.partner}` : ""}`
    : input.partner
      ? `eyeline toward off-screen ${input.partner}, who is NOT in the frame`
      : "eyeline off-screen, never into lens";
  const speech =
    input.audioRole === "offscreen"
      ? "Listener close-up only. Mouth closed or slightly open, listening. Do not speak. Do not lipsync. The other speaker is off-camera and must not appear."
      : input.dialogue
        ? `This one person speaks exactly this line, using Audio 1 as the spoken performance: "${input.dialogue}"`
        : "silent reaction of this one face, mouth closed or slightly open";
  return [
    `COVERAGE SINGLE. ${framingForFunction(input.shotFunction)} FORBIDDEN: OTS, over-the-shoulder, over-shoulder, second head, second person, couple, two-shot, anyone else's shoulder.`,
    who,
    input.camera ? stripCopyrightBait(input.camera) : null,
    "IDENTITY LOCK. Image-to-video from reference image 1 only.",
    `${move}, same clothes as reference, do not change face, do not change hair, do not change outfit.`,
    "Do not invent a teal cardigan, navy suit, new haircut, or second person.",
    single
      ? "FORBIDDEN: second person, second head, couple, talking two-shot, both people speaking in frame, OTS, over-the-shoulder."
      : null,
    `Lighting lock: ${lighting}. Geography must match the location plate.`,
    LOCKED_TAKE_CLAUSE,
    `${eyeline}, ${NO_LENS_CLAUSE}`,
    input.emotion ? stripCopyrightBait(input.emotion) : null,
    speech,
    MODEST_SHOT_CLAUSE,
    "Same person as reference image 1. Lock hair, clothes, age, and face. No costume change. Do not invent a second body.",
    NO_TEXT_CLAUSE,
  ]
    .filter(Boolean)
    .join(" | ");
}
