import type { EpisodeLength } from "../../engine/config/catalog.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import type { GenrePlaybook } from "../types/genre.ts";
import { blockingPrompt, peopleInTake, sceneBlockingOf, type LooseBlocking } from "../types/continuity.ts";
import { placeKind, placeLockClause, placeNoun } from "./place.ts";
import { COVERAGE_CLAUSE, JOIN_CUT_CLAUSE } from "./coverage.ts";
import { seedanceSpeechBlock, SHORT_DRAMA_SCORE } from "./seedance-speech.ts";
import { sceneTakeShotList, shotListPrompt } from "./shot-list.ts";
import { TALK_RULES } from "../types/talk.ts";

export const LOCKED_TAKE_CLAUSE =
  "single continuous take, no cuts, no smash cuts, no shot changes, locked-off or one simple move";

export const NO_LENS_CLAUSE =
  "never look into the lens except one private tell: a half-second glance past the camera, then eyes back to the partner. No selfie, no vlog, no fourth-wall grin";

export const MODEST_SHOT_CLAUSE =
  "Clothes stay on. Opaque contemporary wardrobe — a dress, a suit, a blouse, trousers. No extra people, no crowd, no unnamed body.";

export const UAE_MEDIA_CLAUSE =
  "DECENCY. Clothes stay on. No drugs. Adults only. A normal short drama is fine: close faces, a charged almost-kiss, a glass on the table, a fight in words. Do not take clothes off. No weapons and no crime in progress. Animals only inside a closed carrier or heard off-screen. No harm to animals.";

export const SCENE_TAKE_BODY_CLAUSE = COVERAGE_CLAUSE;

export function sceneTakeBodyClause(_coverage?: string | null): string {
  return COVERAGE_CLAUSE;
}

export const SCENE_TAKE_HANDOFF_CLAUSE =
  "HANDOFF. Hard cuts only between numbered shots. Each cut CHANGES the camera: closer, slightly behind one person, then slightly behind the other, or both faces stacked near the lens. No dissolves, no morphs. Shot 1 may open on both upper bodies. Every later take JOINS closer — never reopen on a wide master. A close-up HOLDS for the whole line — two seconds minimum — never a one-frame flash back to the master. A motivated slow push-in on heat is legal. Same place, same key light, same ground. NO DEAD AIR: the next line starts the moment the last one lands. Never speak a character name unless it is inside the braces. Never speak a label.";

export const SCENE_TAKE_PHYSICS_CLAUSE =
  "PHYSICS. Bodies obey gravity and the ground. Everyone is exactly where STAGING puts them — on the ground, kneeling, seated, leaning against a wall, or standing — and stays there in every shot. A person on the ground is low in frame with the ground visibly under them; a standing person has feet on the ground. No torso merges with a wall or a fixture; nothing floats; nobody sits on a surface that is not a seat. Walls, ground, and fixtures keep their size and place; a surface never stretches, shrinks, or becomes a different object. The prop rests where STAGING says with its base flat.";

export const SCENE_TAKE_PROXIMITY_CLAUSE =
  "PROXIMITY. Short-drama staging is close. The two leads are within arm's reach, faces a forearm apart, eyes locked; the space between them is charged, not polite. A third person keeps one step back. Posture carries status: the one with power is still and square; the one cornered grips, leans, or lifts the chin.";

export const CAST_LOOK_CLAUSE =
  "CAST LOOK. Short drama is sold on faces. Every named adult is strikingly beautiful in a phone-close way: clear skin, defined features, eyes you want to stay with. The viewer should think she is beautiful, he is beautiful. Write specific beauty — eyes, bone, mouth, hair — never average, plain, or tired. Fictional adults only. Do not copy a public figure. Beauty is the face and the presence. Clothes stay modest and on.";

export const FACE_DISTANCE_CLAUSE =
  "FACE DISTANCE. You are never too far from the scene. Faces stay large enough to feel personal — FaceTime or closer. Most shots are faces. A step back still keeps both upper bodies filling the frame. If you cannot read the eyes, you are too far. The audience is here to be close to beautiful people.";

export const MICRO_DRAMA_REGISTER_CLAUSE =
  "REGISTER. Asian-style vertical short drama for a For You page. About a one-million-dollar show — not prestige film, not a billion-dollar Hollywood look, not an orchestra. " +
  `${FACE_DISTANCE_CLAUSE} ` +
  "Many face shots. Dirty singles, held close-ups, stacked faces, OTS on a beautiful face. Emotions land in a beat: a freeze, a swallow, one eye, a breath — then cut. Do not hold a long expression. Cycle: both upper bodies FaceTime-close, over-the-shoulder, dirty single, held close-up, one-second ECU, reverse, stacked faces, a half-step that still keeps the faces large, punch in on a doorway. Camp is one funny face plus a whoosh, under a second, then back to the fight. Cheap thriller light, not a cinematic grade. Faces stay flattering: catchlight in the eyes, skin that reads clean on a phone.";

/** Official Seedance speech. Never dump NAME: lines — the model will speak the label. */
export function speechLockClause(
  script: string,
  sides?: { camera_left?: string | null; camera_right?: string | null } | null,
): string {
  return seedanceSpeechBlock(script, sides);
}

export function roomGeometryClause(input: { location?: string | null; description?: string | null; geometry?: string | null }): string | null {
  const parts = [input.geometry?.trim(), input.description?.trim()].filter((row): row is string => Boolean(row));
  if (!parts.length) return null;
  const name = (input.location ?? "this place").split(" — ")[0];
  const noun = placeNoun(input.location);
  const outdoor = placeKind(input.location) === "outdoor";
  const extras = outdoor
    ? "Do not add a wall, curtain, or piece of furniture that is not in the plates."
    : "The camera never shows a wall or object that is not in the plates.";
  return `SET LOCK for ${name}: ${parts.join(". ")}. The attached plates are the geography of this ${noun}: every wall, opening, ground plane, and fixture keeps its place and size in every shot and every cut. ${extras} Nothing new is built between shots; nothing changes into something else.`;
}

export function speakersFromSceneScript(script?: string | null): string[] {
  const names: string[] = [];
  for (const raw of (script ?? "").split("\n")) {
    const match = raw.match(/^([A-Za-z][A-Za-z0-9' .-]{0,40}):\s/);
    if (!match) continue;
    const name = match[1].trim();
    if (name && !names.some((row) => row.toUpperCase() === name.toUpperCase())) names.push(name);
  }
  return names;
}

/**
 * Who speaks in this take, up to three people. The scene card's first two
 * names are not the cast — a kitchen card is often Mara/Petra while this
 * beat is Mara/Cole/Felix.
 */
export function speakersForSceneTake(input: {
  sceneScript?: string | null;
  speaker?: string | null;
  speakerOnCamera?: string | null;
}): string[] {
  const fromScript = speakersFromSceneScript(input.sceneScript);
  if (fromScript.length) return fromScript.slice(0, 3);
  const named: string[] = [];
  for (const name of [input.speaker, input.speakerOnCamera]) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    if (named.some((row) => row.toUpperCase() === trimmed.toUpperCase())) continue;
    named.push(trimmed);
  }
  return named.slice(0, 3);
}

export function sameSpeakerCast(before: readonly string[], after: readonly string[]): boolean {
  if (before.length !== after.length) return false;
  const fold = (name: string) => name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const have = new Set(after.map(fold).filter(Boolean));
  return before.every((name) => have.has(fold(name)));
}

/** Speakers plus anyone already in the room. A silent third person still packs. */
export function peopleOnSceneTake(input: {
  sceneScript?: string | null;
  speaker?: string | null;
  speakerOnCamera?: string | null;
  blocking?: LooseBlocking | null;
}): string[] {
  return peopleInTake({
    speakers: speakersForSceneTake({
      sceneScript: input.sceneScript,
      speaker: input.speaker,
      speakerOnCamera: input.speakerOnCamera,
    }),
    blocking: input.blocking,
  });
}

/** Face lock for Seedance. Never `NAME:` — that colon pattern makes the model say the name. */
export function identityLockLine(name: string): string {
  return `Keep ${name}'s locked adult face and age from their frontal still. Do not make them older or greyer.`;
}

export const EMPTY_ROOM_CLAUSE =
  "EMPTY ROOM. NO people. NO bodies. NO faces. NO extras. NO crowd. NO clothing on a body. No invented person, no headless torso.";

export const NO_TEXT_CLAUSE = "no text, no captions, no logos, no UI";

const FACE_CAMERA = /\b(face|eyes|jaw|brow|mouth|portrait|close-up on \w|tight single on \w)/i;

const COPYRIGHT_SAFE =
  "no logo, no brand name, no barcode, no printed merchant, no printed personal name, no readable date that looks like an ID";

export function identitySafeLocation(location?: string | null, note?: string | null): string {
  const place = (location ?? (placeKind(location) === "outdoor" ? "night street" : "night interior")).replace(/\s+/g, " ").trim();
  const described = note?.trim() ? ` ${note.trim().replace(/\.?$/, ".")}` : "";
  const other = placeKind(location) === "outdoor" ? "no random other street, no indoor room" : "no random other room";
  return `same ${place}, same key light and grade as the location plate.${described} No night-forest bokeh, ${other}, no readable signage`;
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
    case "reaction":
    case "listener_hold":
      return "Medium close-up of ONE person from the chest up. Face in the upper third, shoulders and some of the room visible behind them. Locked off. NEVER a face-filling extreme close-up.";
    case "slap_peak":
    case "doorway_reveal":
      return "Medium single of ONE person from the chest up with room to move, locked off. The room stays readable. NEVER a face-filling crop.";
    default:
      return "Medium close-up of ONE person from the chest up, face in the upper third, room visible, locked off. NEVER a face-filling extreme close-up.";
  }
}

const OBJECT_WORDS =
  /\b(paper|letter|envelope|note|phone|screen|ring|key|keys|photo|photograph|glass|receipt|contract|badge|watch|knife|ticket|passport|locket|necklace|cup|bottle|card|document|file|folder|box|pill|bracelet|invitation|carrier)s?\b/i;

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
  return "unlabeled paper on dark stone, handwritten block letters only";
}

export function stripCopyrightBait(text: string): string {
  return text
    .replace(/\bPenthouse\b/gi, "night interior")
    .replace(/\bJules(?:\s+Renner)?\b/gi, "")
    .replace(/\b41A\b/gi, "")
    .replace(/\b11:?40\b/gi, "")
    .replace(/\breceipt\b/gi, "paper")
    .replace(/\b(doordash|door dash|uber eats|talabat|deliveroo)\b/gi, "delivery bag")
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
  if (long) {
    return `You are the drama engine for Short Drama Maker, a commercial vertical short-drama studio — not a generic AI film studio and not an opera director.
Rules you must follow:
- Every character is fictional and 18+ looking. Never use a real person's name or likeness.
- Dialogue-first. Narration is off. No voice-over, no narrator lines. VO is banned except a private contradiction whispered on-camera.
- Planner target: 12–18 scene-blocks, each a 50–75s Beat Engine of 8–12 locked takes (15 min is not 180 random 5s clips and not one 60s beat repeated), ${budget.min_shot_s}–${budget.max_shot_s} seconds each (dialogue hard cap ${budget.max_dialogue_s}s). One line or one action per take.
- Each block: hook → friction → spike → button into the next block. Emotion node every 20–30s. Mid-episode reprice at ~7–8 min. Final button cliffs into the next episode.
- Cast: 3–8 named locked-cast roles tagged Engine / Wall / Witness / Nuke. No unnamed extras.
- Off-screen speech over a listener CU is first-class. Never lipsync the listener.
- One simple camera move per locked take is legal. Still no internal cuts and never write Shot 1:.
- Last-shot button must ask a NEW unpaid question — not a repeat of the hook line.
- Silence is legal only as a priced reaction (1.5–3s after slap/nuke) or a ≤2s button freeze.
- Camera strings describe ONE picture. Never write edit verbs: Cut to, smash, Shot 1:, Hold for N seconds.
- Spike must be mute-readable (a slap, a paper, a mark, a doorway — not a speech-only twist).
- ${CAST_LOOK_CLAUSE}
- ${FACE_DISTANCE_CLAUSE}
- ${MODEST_SHOT_CLAUSE}
- Return JSON only. No markdown.`;
  }
  return `You are the drama engine for Short Drama Maker. A micro drama is an advertisement for coins. Write like an ad copywriter. Prestige-TV instincts are a FAIL.
Rules you must follow:
- Every character is fictional and 18+ looking. Never use a real person's name or likeness.
- Episode is ${budget.duration_sum_min}–${budget.duration_sum_max}s (~${budget.target_episode_seconds}s). ${budget.min_shots}–${budget.max_shots} CONTINUOUS SCENE TAKES, ${budget.min_shot_s}–${budget.max_shot_s}s each — use the model's full length. One locked room for the whole episode.
- edit_mode=scene_take. scene_script is a REAL conversation: people answer each other, name the mechanism, interrupt, press. 5–8 cues per take. Native speech. Each take must fit ${budget.max_shot_s}s (~${Math.floor((budget.max_shot_s - 0.6) * 2.8)} spoken words). Overflow goes to the next take — never let a line get cut off. FAIL a take with fewer than 5 cues. This is not a trailer.
- ${TALK_RULES}
- Every cue is one sentence, under 12 words. Every line gives something or takes something. Concrete numbers once, never demanded. The signature line is the put-down that reverses status.
- Vertical opposition: name who holds the upper frame in blocking.upper_frame (the one with power stands; the other sits lower or leans in). Power reads top to bottom in 9:16.
- Same location, same camera-left and camera-right, same table, same key light. People do not swap sides. Name the locked prop and keep its shape.
- Spoken hook in the first 3 seconds. Image and line must clash. Cut exposition. No recap, no goodbye, no walking to a door, no establishing wide.
- 4–6 beats (a change in power, knowledge, or presence). Nothing resolves except the season finale.
- End on a CPI moment: a consequence starting, a gut punch, or an unanswerable question. Never end on someone leaving. Last line ≠ first line.
- Each take is generated as 3–4 numbered shots inside one clip, and those shots MUST change camera: a FaceTime-close 3/4 of both faces, over-the-shoulder behind one person, a dirty single, a held close-up, the reverse, or both faces stacked close to the lens. Never write four shots from the same side-profile. Never write a frame so wide the faces shrink. Write the sharpest line mid-take, not first. Put one reaction beat in parentheses inside a cue, e.g. "NAME: (freezes, eyes wet) Say it again."
- Register: vertical micro drama. Heightened, sincere, a little campy. Many face shots. Never too far from the people — FaceTime-close or closer, so the viewer stays with a beautiful face. Emotions land big on the face. Status is visible: who owns the space, who is cornered, who has to look up. The leads stand close — arm's reach, faces a forearm apart, tension in the gap.
- ${CAST_LOOK_CLAUSE}
- ${FACE_DISTANCE_CLAUSE}
- Who is in the room is a ledger. A new character must ENTER on a cue of their own ("FELIX: (enters from the back door, rain on his shoulders) Boss—"). A character leaves only on a cue with an exit beat ("COLE: (turns and leaves) Late."). Nobody appears or vanishes between takes. Never move people any other way.
- One private TELL per episode: after the other person looks away, a face changes for one beat — a small smile, a glance to the side past the lens, a swallowed word — written as a parenthetical. The audience learns something the other character does not.
- Dramatic irony is the engine: when the bible says one lead hides who they are, the audience must know it by the end of episode 1 and the other lead must not.
- STAGING is where you reason like a director. Read the script and put bodies where the story puts them: a man who collapsed is on the ground against a wall, not at a table; the person who saved him kneels over him; rain means soaked hair and clothes. An outdoor location stays outdoor: wet brick, pavement, street lamp — never curtains, blinds, or kitchen furniture in the street. Write blocking.staging for every take. Staging changes only when a cue says someone moves (stands, sits, steps back), and then the next take's staging shows the new position. Write blocking.anchor: the one physical thing the bodies are anchored to.
- Physics: nobody sits on or merges with furniture; a person on the ground stays on the ground until a cue lifts them. Never invent an extra person. Never write weekday-name filler ("same as every Tuesday").
- Cast: 4–5 named locked-cast roles tagged Engine / Wall / Witness / Nuke. 3–5 reused locations. Speakers must match locked-cast names.
- Never write crowds, locomotion, fights, task hands, readable in-frame text, mirrors, children, or driving. Animals only inside a closed carrier or heard off-screen.
- Spike must be mute-readable: an object, a mark, a doorway, an arrival — the story's own prop, never a speech-only twist.
- ${UAE_MEDIA_CLAUSE}
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
Write 12–18 scene-blocks. Each block is a full 50–75s Beat Engine. Mid-reprice one block near index 6–8. Each block closes a hook and opens a higher one. Final button is an unpaid question into the next episode. Carry one through-line: the story's own prop, name, or secret. Do not copy the same argument 15 times. Chinese short-drama writing: punchy, public humiliation, mute-readable spike, humor sting on "I didn't know."
CAST LOOK and FACE DISTANCE apply: strikingly beautiful phone-close faces; if you cannot read the eyes you are too far.`;
}

export function writeBlockBatchShape(): string {
  return `Plan shots for the given scene-blocks only (a batch of 3–4). Each block: 8–12 locked takes, 4–8s, hook → friction → spike → block_button. Coverage: one establishing/wide of the locked location, one silent two-shot/group when 2+ people, singles for dialogue, one insert, one comic/stun cutaway + SFX. Last block of the episode uses function=button_cu. Dialogue ≤12 words. No Cut to.
CAST LOOK: named faces are specific phone-close beauty, never average. FACE DISTANCE: FaceTime or closer; if you cannot read the eyes you are too far.
DIALOGUE-FIRST: at least 6 of every block's takes carry a spoken line (dialogue non-null, speaker from the locked cast, audio_role onscreen or offscreen). The block_button is always a spoken line. Silent takes are only the establishing, the insert, the two-shot and at most two priced reactions. Two or more different speakers per block.
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
      "edit_mode": "scene_take",
      "scene_script": "NAME: line\\nNAME: line",
      "audio_role": "onscreen",
      "speaker_on_camera": string | null,
      "speakers_off_camera": string[],
      "eyeline": "lens_forbidden",
      "function": "hook_cu" | "scene_take" | "button_cu",
      "camera_move": "slow push" | "slow pull" | "whip to eyeline" | null,
      "comic_sting": boolean,
      "sfx": "impact" | "comic" | "stunned" | "door" | "paper" | null,
      "blocking": {
        "camera_left": "NAME",
        "camera_right": "NAME",
        "prop": "the same closed object on the surface between them",
        "left_gesture": "stands at the locked table facing the other, hands visible",
        "right_gesture": "stands at the locked table facing the other, hands visible",
        "coverage": "two_shot" | "single" | "room" | "cu",
        "pictured": null,
        "upper_frame": "NAME who holds power in this room",
        "staging": "where every body is and in what posture, from the script — e.g. COLE half-sits against the wet brick wall on the ground, soaked; MARA kneels over him, one hand on his shoulder",
        "anchor": "the physical thing the staging is anchored to — e.g. the brick wall and the puddle line",
        "present": ["every named speaker in this take, including a third person"],
        "enters": [],
        "exits": []
      }
    }]
  }]
}
Write ${budget.min_shots}–${budget.max_shots} CONTINUOUS SCENE TAKES. duration_hint_seconds ${budget.min_shot_s}–${budget.max_shot_s} — use the full window so the last spoken word is heard. Sum ${budget.duration_sum_min}–${budget.duration_sum_max}s.
Each scene_script is a conversation of 5–8 cues that fits the ${budget.max_shot_s}s window. The sharpest line sits mid-take. One cue carries a reaction beat in parentheses before the words. One location for the episode. Same camera-left / camera-right and the same prop. People do not swap sides.
edit_mode=scene_take. First take function=hook_cu and already in motion. Last take function=button_cu on a CPI moment (consequence starting / gut punch / unpaid question).
No singles. No establishing wide. No recap. No goodbye. No walking. Clothes stay on. No drugs.
Bible has 4–5 named roles including a Witness and 3–5 reused locations. Scene characters list who is in that room. Speakers match locked-cast names.
Name someone at most once per take, and only when it lands. Numbers concrete. No Cut to / Shot N: / Hold for.`;
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

export type SceneTakeImageRole = "face" | "front" | "profile" | "wardrobe" | "room" | "prop" | "weld" | "video";

function cameraSideOf(
  name: string,
  sides?: { camera_left?: string | null; camera_right?: string | null } | null,
): "camera-left" | "camera-right" | null {
  const key = name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (!key) return null;
  const left = sides?.camera_left?.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const right = sides?.camera_right?.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (left && key === left) return "camera-left";
  if (right && key === right) return "camera-right";
  return null;
}

export function sceneTakeImageLocks(
  labels: Array<{ role: SceneTakeImageRole; name: string }>,
  sides?: { camera_left?: string | null; camera_right?: string | null } | null,
): string {
  let image = 0;
  const faces: string[] = [];
  const body = labels
    .filter((row) => row.role !== "video")
    .map((row) => {
      image += 1;
      const tag = `@Image${image}`;
      if (row.role === "profile") {
        return `${tag} is ${row.name}'s locked side face. Same person as their frontal still. Same hairline, nose, and age. Face and clothes only. Do not copy a high studio angle.`;
      }
      if (row.role === "wardrobe") {
        return `${tag} is ${row.name}'s locked clothes for this scene. This exact outfit on ${row.name} in every shot. Do not change outfit, do not change colour, do not add a jacket or remove one.`;
      }
      if (row.role === "room") {
        return row.name === "room" || row.name === "room-wide"
          ? `${tag} is the locked empty place plate, main angle. Walls, ground, fixtures, and key light only. Nobody is in that still. Keep this exact layout and scale in every shot. It is geography, not a new face. Do not add dressing that is not in the plate.`
          : `${tag} is the same empty place from another angle (${row.name.replace(/^room-/, "")}). Same walls, same ground, same light. Use it when a shot faces that way. Nobody is in it; it is geography, not a new face.`;
      }
      if (row.role === "prop") {
        return `${tag} is the locked ${row.name}. Same object, same shape, same place. Do not redesign it. It is not a face.`;
      }
      if (row.role === "weld") {
        return `${tag} is the locked end picture of this same room and the same two people. Keep the same furniture, the same sides, the same prop. Do not invent a new face from it. Do not replay that picture as a new scene.`;
      }
      const side = cameraSideOf(row.name, sides);
      const slot = side ?? "their locked side";
      faces.push(`${tag} is ${row.name}, ${slot}. Only this mouth moves on the brace lines for ${slot}.`);
      return `${tag} is ${row.name}'s locked frontal face, ${slot}. Keep this exact adult face, age, hair, and skin. Only this mouth moves on the brace lines for ${slot}. Do not morph them into a different person. Face and clothes only. If the still is a high-angle studio portrait, do not copy that angle or treat the studio floor as a counter.`;
    })
    .join(" ");
  if (!faces.length) return body;
  return `${body} MOUTH LOCK. ${faces.join(" ")} A closed mouth never speaks the other person's line.`;
}

export function sceneTakePrompt(input: {
  location?: string | null;
  locationNote?: string | null;
  camera: string;
  people: string[];
  sceneScript: string;
  emotion?: string | null;
  identityLocks?: string[];
  imageLocks?: Array<{ role: SceneTakeImageRole; name: string }>;
  blocking?: LooseBlocking | null;
  durationSeconds?: number | null;
  takeIndex?: number | null;
  /** Bible line for this room plus any vision geometry note; keeps the floor plan fixed. */
  roomDescription?: string | null;
  roomGeometry?: string | null;
}): string {
  const lighting = identitySafeLocation(input.location, input.locationNote);
  const who = peopleOnSceneTake({
    sceneScript: input.sceneScript,
    speaker: input.people[0],
    speakerOnCamera: input.people[1],
    blocking: input.blocking,
  });
  const names = who.length ? who.join(" and ") : "the named speakers";
  const count = who.length === 1 ? "one person" : `${who.length || 2} people`;
  const locks = (input.identityLocks ?? []).filter(Boolean);
  const blocking = sceneBlockingOf({ names: who, camera: input.camera, scene_script: input.sceneScript, blocking: input.blocking });
  const images = sceneTakeImageLocks(input.imageLocks ?? [], blocking);
  const camera = input.camera
    ? stripCopyrightBait(input.camera).replace(/\b(waist|chest)\s+up\b/gi, "mid-thigh up")
    : null;
  const shots = sceneTakeShotList({
    script: input.sceneScript,
    duration: input.durationSeconds ?? 15,
    blocking,
    location: input.location,
    takeIndex: input.takeIndex,
  });
  const shotCount = shots.length;
  const noun = placeNoun(input.location);
  return [
    `ONE CONTINUOUS SCENE, ${shotCount === 1 ? "one locked shot" : `cut as ${shotCount} numbered shots`}, ${Math.round(input.durationSeconds ?? 15)} seconds total, 9:16. Photoreal live-action, a finished location, not a set. No replay of a previous generation.`,
    `ONLY ${count} in this ${noun}: ${names}. Nobody else. No extra body. No extra hand. No background watcher. Do not add a person from a previous take. Nobody appears or disappears except the scripted entrance or exit.`,
    "IDENTITY LOCK. Reference-to-video from the attached frontal stills only. Those stills are the only legal faces, in every shot. A place plate is empty geography, not a new person. If any extra still shows a different face, ignore that face. Do not attach or remake a previous take.",
    locks.length ? `Locked faces: ${locks.join(" ")}` : null,
    images || null,
    speechLockClause(input.sceneScript, blocking),
    SHORT_DRAMA_SCORE,
    sceneTakeBodyClause(input.blocking?.coverage),
    (input.takeIndex ?? 0) > 0 ? JOIN_CUT_CLAUSE : null,
    camera ? `Shot 1 framing: ${camera}` : null,
    blockingPrompt(blocking, input.location),
    SCENE_TAKE_PHYSICS_CLAUSE,
    SCENE_TAKE_PROXIMITY_CLAUSE,
    placeLockClause(input.location),
    roomGeometryClause({ location: input.location, description: input.roomDescription, geometry: input.roomGeometry }),
    `Lighting lock: ${lighting}. Same ground and walls at the same size, same key light, same geography in every shot.${
      (input.takeIndex ?? 0) > 0
        ? " Do not invent a new lamp color. If the last frame's lighting cannot match, Shot 1 is closer so the room is not compared."
        : ""
    }`,
    CAST_LOOK_CLAUSE,
    MICRO_DRAMA_REGISTER_CLAUSE,
    `SHOT LIST. ${shotListPrompt(shots)}`,
    SCENE_TAKE_HANDOFF_CLAUSE,
    NO_LENS_CLAUSE,
    input.emotion ? stripCopyrightBait(input.emotion) : null,
    UAE_MEDIA_CLAUSE,
    MODEST_SHOT_CLAUSE,
    "Do not invent a person who is not named in this take. Do not change wardrobe or faces between shots.",
    NO_TEXT_CLAUSE,
  ]
    .filter(Boolean)
    .join(" | ");
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
      "HOLLYWOOD ESTABLISHING / WIDE. Work the room exactly as the location plate shows it.",
      people,
      `Lighting lock: ${lighting}. Do not jump to a different place or night-forest bokeh.`,
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
  // MCU, not ECU: the room has to read as the same space the other person is in.
  // A tiny locked push is legal; a face-filling crop is not.
  const moveForSingle =
    "locked-off or one tiny slow push; medium close-up from the chest up; the room stays visible around the person; face in the upper third, never filling the frame; same eyeline the whole take";
  const eyeline = input.eyeline && input.eyeline !== "lens_forbidden"
    ? `eyeline ${input.eyeline}${input.partner ? ` toward off-screen ${input.partner} as if they share this room` : ""}`
    : input.partner
      ? `eyeline toward off-screen ${input.partner}, who is in this same room but NOT in the frame`
      : "eyeline off-screen to the scene partner, never into lens";
  const speech =
    input.audioRole === "offscreen"
      ? "Listener medium close-up only. Mouth closed or slightly open, listening to the off-screen partner in this same room. Do not speak. Do not lipsync. The other speaker must not appear."
      : input.dialogue
        ? `This one person speaks the COMPLETE line with native speech, one sentence, and does not stop until the last word: "${input.dialogue}"`
        : "silent reaction of this one person, mouth closed or slightly open, answering the off-screen partner";
  return [
    `COVERAGE SINGLE. ${framingForFunction(input.shotFunction)} FORBIDDEN: OTS, over-the-shoulder, over-shoulder, second head, second person, couple, two-shot, anyone else's shoulder.`,
    who,
    input.camera ? stripCopyrightBait(input.camera) : null,
    "IDENTITY LOCK. Image-to-video from @Image1 only.",
    `${moveForSingle}, same clothes as reference, do not change face, do not change hair, do not change outfit.`,
    "Do not invent a teal cardigan, navy suit, new haircut, or second person.",
    single
      ? "FORBIDDEN: second person, second head, couple, talking two-shot, both people speaking in frame, OTS, over-the-shoulder."
      : null,
    `Lighting lock: ${lighting}. This is a shared place — geography and key light must match the location plate so the next cut still feels like the same scene.`,
    LOCKED_TAKE_CLAUSE,
    `${eyeline}, ${NO_LENS_CLAUSE}`,
    input.emotion ? stripCopyrightBait(input.emotion) : null,
    speech,
    MODEST_SHOT_CLAUSE,
    "Same person as @Image1. Lock hair, clothes, age, and face. No costume change. Do not invent a second body.",
    NO_TEXT_CLAUSE,
  ]
    .filter(Boolean)
    .join(" | ");
}
