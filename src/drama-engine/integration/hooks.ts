import type { EpisodeLength } from "../../engine/config/catalog.ts";
import type { EpisodePlan, RenderManifest, Shot, StoryBible } from "../../engine/domain.ts";
import {
  lockedTakePrompt,
  objectPlateCamera,
  playbookPrompt,
  stripCopyrightBait,
  systemDramaRules,
  writeBlockBatchShape,
  writeEpisodeShape,
} from "../craft/prompt-fragments.ts";
import { inferGenre, playbookFor, punishAllowed } from "../craft/genre-playbooks.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import { buildRenderManifest } from "../editorial/manifest-builder.ts";
import { assertDramaPlan, repairEpisodePlan, validateEpisodePlan, type ValidatePlanInput } from "../lint/index.ts";
import { allocateShotDuration } from "../pacing/duration-allocator.ts";
import { buildSeasonCraft, enrichEpisodeStructure, recapAllowed, recapBudgetSeconds } from "../plans/index.ts";
import { allowsTwoShot, isObjectInsert, type AudioRole } from "../types/editorial.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import type { DramaLintResult } from "../types/qc-drama.ts";
import type { SkuPolicy } from "../types/genre.ts";
import type { VideoRoute } from "../../engine/domain.ts";

export type DramaEngineHooks = {
  enrichBiblePrompt(base: string, input: { title: string; idea: string; skuPolicy?: SkuPolicy }): string;
  validateEpisodePlan(input: ValidatePlanInput): DramaLintResult;
  repairEpisodePlan(input: ValidatePlanInput): EpisodePlan;
  assertEpisodePlan(input: ValidatePlanInput): EpisodePlan;
  buildVideoPrompt(input: {
    location?: string | null;
    shot: Shot;
    partner?: string | null;
    peopleCount?: number;
  }): string;
  allocateDurations(input: {
    wavSeconds: number;
    route: Pick<VideoRoute, "min_duration_seconds" | "max_duration_seconds">;
    audioRole?: AudioRole | null;
    length?: EpisodeLength;
  }): ReturnType<typeof allocateShotDuration>;
  buildRenderManifest(input: {
    episode_id: string;
    shots: Shot[];
    assetIdFor: (shot: Shot) => string;
    durationFor?: (shot: Shot) => number | null | undefined;
  }): RenderManifest;
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
Cast jobs: tag every named role Engine / Wall / Witness / Nuke. 3–8 named speaking roles. No unnamed extras.
Episode structure: mark type (HookEp/RevealEp/ConfrontationEp/CliffhangerEp/ComfortEp/TentpoleEp), cliffhanger, tentpole on E1/E3/E5/E10, paywall_flag on the last free episode (E5–E10).
Magic moments first: reject a bible with fewer than 8 filmable public turns.
Do not write a 90-minute movie and slice it.`;
    },

    validateEpisodePlan,
    repairEpisodePlan,
    assertEpisodePlan: assertDramaPlan,

    buildVideoPrompt(input) {
      const data = input.shot.shot_data;
      const twoShot = allowsTwoShot(data.function);
      const objectInsert = isObjectInsert(data);
      const camera = objectInsert
        ? objectPlateCamera(data.function, data.camera, { dialogue: data.dialogue })
        : stripCopyrightBait(
            sanitizeCamera(data.camera, {
              lockedTake: (data.edit_mode ?? "locked_take") !== "already_cut",
              single: !twoShot,
            }),
          );
      return lockedTakePrompt({
        location: input.location,
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
      return `Write episode ${input.episodeNumber} as a commercial short-drama shot list for this bible:
${JSON.stringify({ ...input.bible, episode_structure: enrichEpisodeStructure(input.bible) })}

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
