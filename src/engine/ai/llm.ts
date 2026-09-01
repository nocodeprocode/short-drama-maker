import { SCREENPLAY_RULES, type EpisodePlan, type StoryBible } from "../domain.ts";
import type { EpisodeLength } from "../config/catalog.ts";
import { LLM_PRICE, TEXT_MODEL } from "../config/models.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
import type { LLMEngine } from "./types.ts";
import { MODEST_DRESS_RULE, MODEST_WARDROBE_EXAMPLES } from "./modesty.ts";
import { pinLocationToBible } from "../pipeline/location-ref.ts";
import { alignVoicePrompt } from "./voice-sex.ts";
import { openRouterJson, openRouterProvider } from "./openrouter.ts";
import { validateBibleShape, validateBlockScenesShape, validateOutlineShape, validatePlanShape } from "./plan-schema.ts";
import { dramaHooks, ledgerForEpisode } from "../../drama-engine/index.ts";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

async function completeJson<T>(user: string, length: EpisodeLength = "60_90"): Promise<T> {
  const body = await openRouterJson<ChatResponse>("/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      usage: { include: true },
      provider: openRouterProvider(),
      messages: [
        { role: "system", content: `${dramaHooks.systemPrompt(length)}\n- ${MODEST_DRESS_RULE}\n- default_wardrobe must be modest public clothing. ${MODEST_WARDROBE_EXAMPLES}` },
        { role: "user", content: user },
      ],
    }),
  }, { idempotent: true });
  costMeter.record(openRouterUsageCost(body.usage, LLM_PRICE, "llm"));
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no text for a required JSON completion");
  }
  return parseJsonContent<T>(content);
}

function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  throw new Error(
    `OpenRouter returned invalid JSON for a required completion: ${trimmed.slice(0, 180)}`,
  );
}

function assertBible(value: StoryBible): StoryBible {
  if (!value.title || !value.logline || !Array.isArray(value.characters) || value.characters.length < 3) {
    throw new Error("OpenRouter story bible needs 3–8 named roles (Engine / Wall / Witness / Nuke)");
  }
  if (value.characters.length > 8) {
    throw new Error("OpenRouter story bible has more than 8 named roles");
  }
  for (const character of value.characters) {
    if (!character.name || !character.voice_design_prompt || !character.appearance) {
      throw new Error("OpenRouter story bible is missing a character field");
    }
    character.voice_design_prompt = alignVoicePrompt(
      character.voice_design_prompt,
      `${character.name}. ${character.description}`,
    );
  }
  return { ...value, rules: SCREENPLAY_RULES };
}

export function assertPlan(value: EpisodePlan, opts?: { bible?: StoryBible; length?: EpisodeLength; episodeNumber?: number }): EpisodePlan {
  if (!value.title || !Array.isArray(value.scenes) || value.scenes.length === 0) {
    throw new Error("OpenRouter episode plan is empty");
  }
  const namedCast = (opts?.bible?.characters ?? []).map((row) => row.name);
  const ledger = ledgerForEpisode(opts?.episodeNumber ?? 1);
  const repaired = dramaHooks.repairEpisodePlan({
    plan: value,
    bible: opts?.bible,
    length: opts?.length,
    namedCast,
    episodeNumber: opts?.episodeNumber,
    ...ledger,
  });
  return dramaHooks.assertEpisodePlan({
    plan: repaired,
    bible: opts?.bible,
    length: opts?.length,
    namedCast,
    episodeNumber: opts?.episodeNumber,
    ...ledger,
  });
}

function pinPlanLocations(plan: EpisodePlan, locations: string[] | undefined): EpisodePlan {
  if (!locations?.length) return plan;
  return {
    ...plan,
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      location: pinLocationToBible(scene.location, locations) ?? scene.location,
    })),
  };
}

export function createOpenRouterLlm(): LLMEngine {
  return {
    async analyzeStory(input) {
      const base = `Build a story bible for a short vertical drama.
Title: ${input.title}
Idea: ${input.idea}

JSON shape:
{
  "title": string,
  "logline": string,
  "characters": [{
    "name": string,
    "description": string,
    "appearance": {
      "age_look": string,
      "ethnicity_notes": "unspecified fictional",
      "hair": string,
      "face": string,
      "body": string,
      "default_wardrobe": "modest public clothing: long sleeves, covered legs, closed neckline"
    },
    "personality": { "core": string, "tell": string, "job": "engine" | "wall" | "witness" | "nuke" },
    "relationships": { [name: string]: string },
    "voice_design_prompt": "Must start with Adult woman or Adult man matching the character, then age, accent, and speaking tone."
  }],
  "locations": string[],
  "episode_structure": [{ "episode_number": number, "title": string, "hook": string, "conflict": string, "type": "HookEp" | "RevealEp" | "ConfrontationEp" | "CliffhangerEp" | "ComfortEp" | "TentpoleEp", "cliffhanger": string, "tentpole": boolean, "paywall_flag": boolean }],
  "visual_style": { "format": "9:16", "lighting": string, "camera": string }
}`;
      return assertBible(validateBibleShape(await completeJson<unknown>(dramaHooks.enrichBiblePrompt(base, input))));
    },

    async writeEpisode(input) {
      const locations = input.bible.locations ?? [];
      const length = input.episode_length ?? "60_90";
      return pinPlanLocations(
        assertPlan(
          validatePlanShape(
            await completeJson<unknown>(
              dramaHooks.writeEpisodeUserPrompt({
                bible: input.bible,
                episodeNumber: input.episodeNumber,
                length,
              }),
              length,
            ),
          ),
          { bible: input.bible, length, episodeNumber: input.episodeNumber },
        ),
        locations,
      );
    },

    async planShots(input) {
      const locations = input.bible?.locations ?? input.plan.scenes.map((scene) => scene.location);
      const length = input.episode_length ?? "60_90";
      return pinPlanLocations(
        assertPlan(
          validatePlanShape(
            await completeJson<unknown>(
            `Tighten this episode plan. Keep the same story. Enforce dialogue-first, hook/friction/spike/button, one reaction or listener_hold, off-screen over listener, no opera, no edit verbs in camera, 9:16.
Do not change scene location strings. Each location must stay one of: ${locations.join(" | ")}
${JSON.stringify(input.plan)}
Return the same JSON shape with edit_mode, audio_role, function, eyeline filled.`,
              length,
            ),
          ),
          { bible: input.bible, length },
        ),
        locations,
      );
    },

    async outlineEpisode(input) {
      const length = input.episode_length ?? "900_1080";
      return validateOutlineShape(
        await completeJson<unknown>(
          `Outline a ${length === "900_1080" ? "15-minute" : length} vertical short-drama episode for this bible. Do not write shots.
${JSON.stringify({ title: input.bible.title, logline: input.bible.logline, characters: input.bible.characters.map((row) => row.name), locations: input.bible.locations })}
Episode ${input.episodeNumber}.
${dramaHooks.writeEpisodeUserPrompt({ bible: input.bible, episodeNumber: input.episodeNumber, length })}`,
          length,
        ),
      );
    },

    async writeEpisodeBlocks(input) {
      const length = input.episode_length ?? "900_1080";
      return validateBlockScenesShape(
        await completeJson<unknown>(
          dramaHooks.writeBlockBatchPrompt({
            bible: input.bible,
            outline: input.outline,
            blocks: input.blocks,
            length,
          }),
          length,
        ),
      );
    },
  };
}
