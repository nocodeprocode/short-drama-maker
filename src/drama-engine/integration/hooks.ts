import type { EpisodeLength } from "../../engine/config/catalog.ts";
import type { EpisodePlan, RenderManifest, Shot, StoryBible } from "../../engine/domain.ts";
import {
  evidenceMotif,
  lockedTakePrompt,
  sceneTakePrompt,
  peopleOnSceneTake,
  objectPlateCamera,
  playbookPrompt,
  stripCopyrightBait,
  systemDramaRules,
  writeBlockBatchShape,
  writeEpisodeShape,
} from "../craft/prompt-fragments.ts";
import { inferGenre, playbookFor, punishAllowed } from "../craft/genre-playbooks.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import { buildRenderManifest, type ManifestBuildInput } from "../editorial/manifest-builder.ts";
import { assertDramaPlan, repairEpisodePlan, validateEpisodePlan, type ValidatePlanInput } from "../lint/index.ts";
import { allocateShotDuration } from "../pacing/duration-allocator.ts";
import { buildSeasonCraft, enrichEpisodeStructure, recapAllowed, recapBudgetSeconds } from "../plans/index.ts";
import { allowsTwoShot, cameraIsObjectPlate, isObjectInsert, isSceneTake, type AudioRole } from "../types/editorial.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import {
  CLIFF_SHAPE_NOTES,
  cliffShapeFor,
  coreExpectationFrom,
  isLoopOpener,
  loopForEpisode,
  seasonMovementFor,
  TAG_STACK_RULE,
} from "../types/micro-drama.ts";
import { DROP_IN_RULES } from "../types/drop-in.ts";
import { PHYSICS_RULES } from "../types/physics.ts";
import { CUT_RULES } from "../types/cut.ts";
import type { DramaLintResult } from "../types/qc-drama.ts";
import type { GenreId, SkuPolicy } from "../types/genre.ts";
import type { VideoRoute } from "../../engine/domain.ts";

export type DramaEngineHooks = {
  enrichBiblePrompt(base: string, input: { title: string; idea: string; skuPolicy?: SkuPolicy }): string;
  validateEpisodePlan(input: ValidatePlanInput): DramaLintResult;
  repairEpisodePlan(input: ValidatePlanInput): EpisodePlan;
  assertEpisodePlan(input: ValidatePlanInput): EpisodePlan;
  buildVideoPrompt(input: {
    location?: string | null;
    locationNote?: string | null;
    genre?: GenreId | null;
    shot: Shot;
    partner?: string | null;
    peopleCount?: number;
    /** Everyone else in the scene; a single's camera string may not mention them. */
    otherNames?: readonly string[];
    /** Locked age/face lines for scene-take identity. */
    identityLocks?: string[];
    /** Bible line for the room and a vision floor-plan note; both lock geometry across takes. */
    roomDescription?: string | null;
    roomGeometry?: string | null;
    /** 0-based episode take index. Per-scene position resets and must not drive JOIN CUT. */
    takeIndex?: number;
    /** Applicable series / episode / last-clip context for this generation. */
    context?: string | null;
    /** Last framing of the previous generation. Shot 1 must not reprint it. */
    prevLand?: import("../types/cut.ts").CutFraming | null;
  }): string;
  allocateDurations(input: {
    wavSeconds: number;
    route: Pick<VideoRoute, "min_duration_seconds" | "max_duration_seconds">;
    audioRole?: AudioRole | null;
    length?: EpisodeLength;
  }): ReturnType<typeof allocateShotDuration>;
  buildRenderManifest(input: ManifestBuildInput): RenderManifest;
  inferGenre: typeof inferGenre;
  sanitizeCamera: typeof sanitizeCamera;
  lengthBudget(length?: EpisodeLength): (typeof LENGTH_BUDGETS)[EpisodeLength];
  writeEpisodeUserPrompt(input: {
    bible: StoryBible;
    episodeNumber: number;
    length?: EpisodeLength;
    skuPolicy?: SkuPolicy;
  }): string;
  systemPrompt(length?: EpisodeLength): string;
  writeBlockBatchPrompt(input: {
    bible: StoryBible;
    outline: import("../plans/long-form.ts").EpisodeOutline;
    blocks: import("../plans/long-form.ts").EpisodeOutlineBlock[];
    length?: EpisodeLength;
  }): string;
};

export function createDramaEngineHooks(): DramaEngineHooks {
  return {
    enrichBiblePrompt(base, input) {
      const genre = inferGenre(`${input.title} ${input.idea}`);
      const playbook = playbookFor(genre);
      const sku = input.skuPolicy ?? playbook.skuPolicy[0] ?? "en_iap";
      return `${base}

${playbookPrompt(playbook, sku)}
Cast jobs: tag every named role Engine / Wall / Witness / Nuke. 4–5 named speaking roles. 3–5 reused locations. No unnamed extras.
Cast look: every named adult is strikingly beautiful. Write appearance.ethnicity_notes as a locked look (olive / pale-gold / cool brown / warm bronze) — never "unspecified fictional". Write appearance.face as specific beauty (eyes, bone, mouth, hair, skin). appearance.face is a HUMAN face and nothing else: write the eye colour, never a power. Never "eyes that flash gold", "glowing eyes", fangs, fur, or a mark that lights up — the face still is the only legal face, so a glow written here becomes permanent on every shot. The power lives in one scripted parenthetical, never in the look. Eye colour is an everyday human colour — brown, dark brown, hazel, grey, grey-green, dark blue. Never a jewel or neon iris (bright green, ice blue, amber, violet, gold): image and video models render a saturated iris as a self-lit eye in a dim room, which reads as a supernatural tell you did not write. Beauty is bone, mouth, skin, and hair — not eye colour. Boss and assistant must not share a face family. The still is the only legal face; do not recast race. Fictional adults only, every named role 24 or older. A sister is an adult in a hospital bed, not a dependent. Do not copy a public figure. Modest clothes stay on. Beauty is the face.
${TAG_STACK_RULE}
Locations: each is one line — NAME — then the physical facts a video model needs: time of day, weather, the one anchor people gather at, walls, openings, light source, ground or floor. Write the place the story needs. If it is outside, write rain, pavement, masonry, the street lamp — never curtains, blinds, or kitchen furniture in the street. If it is inside, write a finished room with a ceiling. Never a default interior for an outdoor beat.
Title is a 4–8 word trope label from this playbook — do not invent a new genre.
Season bible: 60 episodes, four 15-ep acts, paywall at episode 10, three planted guns, one-line log per episode. Plan the whole season; do not write episodes 4–60 as shots.
Episode structure: mark type (HookEp/RevealEp/ConfrontationEp/CliffhangerEp/ComfortEp/TentpoleEp), cliffhanger, tentpole on E1/E3/E5/E10, paywall_flag on episode 10.
Magic moments first: reject a bible with fewer than 8 filmable public turns.
Do not write a 90-minute movie and slice it.`;
    },

    validateEpisodePlan,
    repairEpisodePlan,
    assertEpisodePlan: assertDramaPlan,

    buildVideoPrompt(input) {
      const data = input.shot.shot_data;
      if (isSceneTake(data)) {
        const people = peopleOnSceneTake({
          sceneScript: data.scene_script,
          speaker: data.speaker,
          speakerOnCamera: data.speaker_on_camera,
          blocking: data.blocking,
        });
        return sceneTakePrompt({
          location: input.location,
          locationNote: input.locationNote,
          camera: data.camera,
          people,
          sceneScript: (typeof data.scene_script === "string" ? data.scene_script.trim() : "") || (data.dialogue ? `${data.speaker ?? "SPEAKER"}: ${data.dialogue}` : "They confront each other."),
          emotion: data.emotion,
          identityLocks: input.identityLocks,
          blocking: data.blocking,
          durationSeconds: data.duration_seconds ?? data.duration_hint_seconds,
          takeIndex: input.takeIndex ?? 0,
          roomDescription: input.roomDescription,
          roomGeometry: input.roomGeometry,
          context: input.context,
          prevLand: input.prevLand,
        });
      }
      const twoShot = allowsTwoShot(data.function);
      const objectInsert = isObjectInsert(data);
      const motif = objectInsert
        ? evidenceMotif({ camera: data.camera, genreMotifs: input.genre ? playbookFor(input.genre).visualMotifs : null })
        : null;
      // A spoken single that still carries a plate camera (an insert that gained a
      // line during repair) is shot on the speaker's face.
      const spokenName = data.speaker_on_camera ?? data.speaker;
      const cameraText =
        !objectInsert && data.dialogue && cameraIsObjectPlate(data.camera)
          ? `Tight single on ${spokenName ?? "the speaker"}'s face, eyes to the off-screen partner`
          : data.camera;
      const camera = objectInsert
        ? objectPlateCamera(data.function, data.camera, { dialogue: data.dialogue, motif })
        : stripCopyrightBait(
            sanitizeCamera(cameraText, {
              lockedTake: (data.edit_mode ?? "locked_take") !== "already_cut",
              single: !twoShot,
              onCameraName: data.speaker_on_camera ?? data.speaker,
              otherNames: input.otherNames,
            }),
          );
      return lockedTakePrompt({
        location: input.location,
        locationNote: input.locationNote,
        motif,
        camera,
        eyeline: data.eyeline,
        partner: input.partner,
        emotion: data.emotion,
        dialogue: data.audio_role === "offscreen" ? null : data.dialogue,
        audioRole: data.audio_role,
        peopleCount: twoShot ? Math.min(2, input.peopleCount ?? 2) : 1,
        onCameraName: data.speaker_on_camera ?? (objectInsert ? null : data.speaker),
        shotFunction: data.function,
        objectInsert,
        allowTwoShot: twoShot,
        cameraMove: data.camera_move,
      });
    },

    allocateDurations(input) {
      return allocateShotDuration({
        wavSeconds: input.wavSeconds,
        route: input.route,
        audioRole: input.audioRole,
        budget: LENGTH_BUDGETS[input.length ?? "60_90"],
      });
    },

    buildRenderManifest,
    inferGenre,

    sanitizeCamera,

    lengthBudget(length = "60_90") {
      return LENGTH_BUDGETS[length];
    },

    writeEpisodeUserPrompt(input) {
      const length = input.length ?? "60_90";
      const genre = inferGenre(`${input.bible.title} ${input.bible.logline}`);
      const playbook = playbookFor(genre);
      const sku = input.skuPolicy ?? playbook.skuPolicy[0] ?? "en_iap";
      const locations = input.bible.locations ?? [];
      const recap = recapAllowed(input.episodeNumber)
        ? `Optional recap_package ≤${recapBudgetSeconds(input.episodeNumber)}s of 2–3 evidence flashes + one line. Never replace the 3s hook.`
        : "No recap on E1.";
      const episodeCount = input.bible.episode_structure?.length || 60;
      const loop = loopForEpisode(input.episodeNumber);
      const movement = seasonMovementFor(input.episodeNumber, episodeCount);
      const shape = cliffShapeFor(input.episodeNumber, episodeCount);
      const opener = isLoopOpener(input.episodeNumber);
      const authored = input.bible.source === "script"
        ? (input.bible.episode_structure ?? []).find((row) => row.episode_number === input.episodeNumber)
        : undefined;
      const source = authored?.source_beats?.length
        ? `
THIS EPISODE IS ADAPTED, NOT INVENTED. The writer uploaded a finished script and these are their beats for episode ${input.episodeNumber}, in order. Shoot these. Do not replace them with a different story, do not reorder them, do not skip one because a trope would be punchier.
${authored.source_beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n")}
${
            authored.source_dialogue?.length
              ? `\nKeep these lines close to the writer's wording. Tighten only for breath and lip-sync:\n${authored.source_dialogue.map((line) => `- ${line}`).join("\n")}`
              : ""
          }
Your job is staging, coverage, and camera. The story is already decided.
`
        : "";
      // Other episodes' uploaded beats stay out of the dump. At 90 episodes they
      // would dwarf the prompt, and this episode's beats are listed in full below.
      const structure = enrichEpisodeStructure(input.bible).map(({ source_beats, source_dialogue, ...row }) => row);
      return `Write episode ${input.episodeNumber} as a commercial short-drama shot list for this bible:
${JSON.stringify({ ...input.bible, episode_structure: structure })}
${source}
Dramatize THIS title and logline only: "${input.bible.title}" — ${input.bible.logline}
Core expectation: ${coreExpectationFrom(input.bible.logline)} Every episode delays the answer and raises its price; nothing resolves before the finale.
The objects, places, and conflict named in the logline and the bible are the episode. Never import an object, room, or plot from anywhere else.

${DROP_IN_RULES}

${PHYSICS_RULES}

${CUT_RULES}

SEASON POSITION. Movement: ${movement.movement} — ${movement.mission}. Loop ${loop.loop} (episodes ${loop.episodes[0]}–${loop.episodes[1]}): ${loop.function}; its pleasure point is "${loop.pleasure}" and it is a partial win only.
END HOOK SHAPE for this episode: ${shape} — ${CLIFF_SHAPE_NOTES[shape]}. The last cue is that shape and no other; the previous episode ended differently.
${
  opener
    ? "LOOP OPENER. A viewer may start here cold. Inside the first take, through conflict and never recap: both leads appear and speak, their relationship is stated on the nose in one line, and the staging shows who holds power. Name someone at most once, and only when it lands. Never name-drop an off-screen person the viewer has not met — say the role in the same breath or put them in the doorway. By the end of the episode a cold viewer knows who these people are and what they want from each other."
    : "MID-LOOP. A viewer who joined two episodes ago must still be able to say who wants what from whom — through conflict, not by saying names every line. Name someone at most once per take. Do not name someone who is not in this take unless the same line identifies them by role."
}
${input.episodeNumber === 1 ? "Episode 1 opens mid-crisis at the height of the conflict, puts both leads on screen together, plants every kernel the season will pay off (the secret, the debt, the rival), and ends on the first unpaid question between the leads." : ""}

${playbookPrompt(playbook, sku)}
Refuse punished tropes for ${sku}. Werewolf is legal on en_iap.
${recap}
${writeEpisodeShape(length)}
Each scenes[].location must be copied verbatim from bible.locations. Speaker must match a bible character first name or full name.
Named cast only.${locations.length ? `\nAllowed locations:\n${locations.map((location) => `- ${location}`).join("\n")}` : ""}`;
    },

    systemPrompt(length = "60_90") {
      return systemDramaRules(length);
    },

    writeBlockBatchPrompt(input) {
      const locations = input.bible.locations ?? [];
      return `Plan shots for these consecutive 15-min episode blocks. Keep the through-line. Do not repeat the previous block's argument.
Outline: ${JSON.stringify(input.outline)}
Blocks to plan now: ${JSON.stringify(input.blocks)}
${writeBlockBatchShape()}
Each scenes[].location must be copied verbatim from bible.locations.
Named cast only.${locations.length ? `\nAllowed locations:\n${locations.map((location) => `- ${location}`).join("\n")}` : ""}`;
    },
  };
}

export const dramaHooks = createDramaEngineHooks();

export function skuAllowsTrope(genreText: string, skuPolicy: SkuPolicy, trope: string): boolean {
  return punishAllowed(playbookFor(inferGenre(genreText)), skuPolicy, trope);
}
