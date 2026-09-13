import { SCREENPLAY_RULES, type EpisodePlan, type StoryBible } from "../domain.ts";
import { assertSeasonBible, buildSeasonBible } from "../../drama-engine/plans/season-bible.ts";
import type { EpisodeLength } from "../config/catalog.ts";
import { LLM_PRICE, TEXT_MODEL } from "../config/models.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
import type { LLMEngine } from "./types.ts";
import { MODEST_DRESS_RULE, MODEST_WARDROBE_EXAMPLES } from "./modesty.ts";
import { pinLocationToBible } from "../pipeline/location-ref.ts";
import { alignVoicePrompt } from "./voice-sex.ts";
import { openRouterJson, openRouterProvider } from "./openrouter.ts";
import { validateBibleShape, validateBlockScenesShape, validateOutlineShape, validatePlanShape } from "./plan-schema.ts";
import { DROP_IN_RULES, dramaHooks, ledgerForEpisode } from "../../drama-engine/index.ts";

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
      // Plans are a few hundred lines of JSON; the default 64k max_tokens is
      // both waste and a 402 when the account is low.
      max_tokens: 16384,
      response_format: { type: "json_object" },
      usage: { include: true },
      provider: openRouterProvider(),
      messages: [
        { role: "system", content: `${dramaHooks.systemPrompt(length)}\n- ${MODEST_DRESS_RULE}\n- default_wardrobe is contemporary clothes that stay on. ${MODEST_WARDROBE_EXAMPLES}` },
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
  return { ...value, rules: SCREENPLAY_RULES, season: assertSeasonBible(buildSeasonBible(value)) };
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
      const cast = (input.required_cast ?? []).filter((row) => row.name.trim());
      const castLine = cast.length
        ? `\nRequired cast — use these names verbatim as named speaking roles and fill the declared job. Do not invent a parallel cast.\n${cast
            .map((row) => {
              const job = row.job ? ` [${row.job}]` : "";
              const note = row.note?.trim() ? ` — ${row.note.trim()}` : "";
              return `- ${row.name}${job}${note}`;
            })
            .join("\n")}\n`
        : "";
      const places = (input.required_locations ?? []).map((row) => row.trim()).filter(Boolean);
      const placeLine = places.length
        ? `\nApproved locations — reuse these strings verbatim in "locations" and set every scene in one of them. Their sets are already built. Add at most one new location.\n${places
            .map((row) => `- ${row}`)
            .join("\n")}\n`
        : "";
      const base = `Build a story bible for a short vertical drama.
Title: ${input.title}
Idea: ${input.idea}
${castLine}${placeLine}
JSON shape:
{
  "title": string,
  "logline": string,
  "characters": [{
    "name": string,
    "description": string,
    "appearance": {
      "age_look": string,
      "ethnicity_notes": "locked look: olive / pale-gold / cool brown / warm bronze — never unspecified or fictional-generic",
      "hair": string,
      "face": "specific phone-close beauty: eyes, bone, mouth, skin — a face the viewer wants to stay with",
      "body": string,
      "default_wardrobe": "contemporary clothes that stay on: a dress, a suit, or a blouse and trousers"
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

    async segmentScript(input) {
      const prompt = `Split an uploaded screenplay into exactly ${input.episodeCount} vertical episodes.

This writer's script is the story. You are cutting it into episodes, not rewriting it.

Rules:
- Exactly ${input.episodeCount} entries, episode_number 1 to ${input.episodeCount}, in the script's own order.
- Cover the whole script. Episode ${input.episodeCount} contains the script's ending.
- Every episode ends on the strongest unresolved moment available at that cut point. Choose the cut, do not invent a new twist.
- source_beats: 3 to 6 short beats for that episode, taken from the script's actual events, in order.
- source_dialogue: up to 4 lines worth preserving close to the writer's wording. Translate to natural English if the script is not English. Omit if the episode has no standout line.
- hook: one sentence naming what opens the episode. conflict: one sentence naming what is fought over.
- cliffhanger: the unresolved moment this episode ends on.
- Use only these character names: ${input.bible.characters.map((row) => row.name).join(", ")}. Map the script's characters onto them.
- Every character is a fictional adult. No real people, no minors, no sexual content.

JSON shape:
{ "episode_structure": [{ "episode_number": number, "title": string, "hook": string, "conflict": string, "cliffhanger": string, "source_beats": string[], "source_dialogue": string[] }] }

SCRIPT:
${input.script}`;
      const body = await completeJson<{ episode_structure?: unknown }>(prompt);
      const rows = Array.isArray(body.episode_structure) ? body.episode_structure : [];
      const structure = rows
        .map((row, index) => {
          const value = (row ?? {}) as Record<string, unknown>;
          const strings = (raw: unknown, cap: number) =>
            Array.isArray(raw)
              ? raw.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, cap)
              : undefined;
          return {
            episode_number: Number(value.episode_number) || index + 1,
            title: String(value.title ?? `Episode ${index + 1}`).slice(0, 80),
            hook: String(value.hook ?? "").slice(0, 400),
            conflict: String(value.conflict ?? "").slice(0, 400),
            cliffhanger: String(value.cliffhanger ?? "").slice(0, 400) || undefined,
            source_beats: strings(value.source_beats, 6),
            source_dialogue: strings(value.source_dialogue, 4),
          };
        })
        .filter((row) => row.hook || row.conflict || row.source_beats?.length)
        .sort((left, right) => left.episode_number - right.episode_number)
        .slice(0, input.episodeCount)
        .map((row, index) => ({ ...row, episode_number: index + 1 }));
      if (structure.length < Math.min(2, input.episodeCount)) {
        throw new Error("Script segmentation returned no usable episodes");
      }
      return structure;
    },

    async writeEpisode(input) {
      const locations = input.bible.locations ?? [];
      const length = input.episode_length ?? "60_90";
      // Shape-check only; repair and assert run once in planEpisode.
      return pinPlanLocations(
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
        locations,
      );
    },

    async planShots(input) {
      const locations = input.bible?.locations ?? input.plan.scenes.map((scene) => scene.location);
      const length = input.episode_length ?? "60_90";
      // Repair and assert once in planEpisode; tightening here only fills craft fields.
      return pinPlanLocations(
        validatePlanShape(
          await completeJson<unknown>(
            `Tighten this episode plan. Keep the same story. 60–90s is continuous scene takes (edit_mode=scene_take), not chopped singles, not off-screen-over-listener. Fill craft fields only. No opera. No edit verbs in camera. 9:16.
Do not change scene location strings. Each location must stay one of: ${locations.join(" | ")}
Keep every shot's blocking object verbatim (camera_left, camera_right, prop, staging, anchor, upper_frame, present, enters, exits); if a scene_take has no blocking.staging, write one from its script: who is where and in what posture. Keep every speaker who already has a line, including a third person. Write blocking.present as every speaker in that take. Each scene_script stays 5–8 cues; do not thin a conversation.
${JSON.stringify(input.plan)}
Return the same JSON shape with edit_mode, audio_role, function, eyeline, blocking filled.`,
            length,
          ),
        ),
        locations,
      );
    },

    async polishSceneDialogue(input) {
      const out = await completeJson<{ takes?: Array<{ index?: number; scene_script?: string }> }>(
        `You are the dialogue writer on a vertical short drama. Rewrite so it sounds like two people in a room who already know the fight — casual, short, implied, charged. Not a Hollywood script. Not a lawyer. Not an article. Not a closing statement.

KILL these on sight:
- Formal talk: "It is not something that I can do." "There are reasons why I cannot go." "Do not bring me to the hospital."
- Refusal loops: Don't take me. / I have to take you. / No, don't. / There are reasons.
- Article voice: "This is the envelope." "This is pack law." "This constitutes." "I am informing you." "The aforementioned." "I hereby." "Please be advised."
- Lecture lore: "That was never a letter." "A claim." "Signed by my hand." "The black one, red wax." "You broke a seal that wasn't yours." "Under pack law."
- Document English: "Then this document constitutes a payment toward the outstanding balance."
- Saying the other person's name every line. "Name, you don't get this."
- Anyone saying "says" or reading a label.

WRITE like this:
- Contractions. I can't go there. You're burning up. Not that place. If they see me I'm done.
- Concrete spoken accusation: "Are you trying to bribe me?" not a definition of the object.
- Imply the reason and the mechanism once. The viewer fills it in. Do not lecture pack law / writ / claim nouns.
  BAD: That was never a letter. / A claim. / Signed by my hand.
  GOOD: You opened it. / So what is it? / Don't play dumb.
  BAD: This is pack law. / You broke a seal that wasn't yours.
  GOOD: You knew I'd open it. / Then why pay my sister?
- One sentence, under 12 words, easy English, no slang, no idiom.
- Same mouth does not wait. Merge two thoughts from one person into one breath. Never two isolated lines with a pause.
- Every line gives or takes something. Answer by deflecting, lying, or flipping status.
- Name someone at most once per take.
- Never name-drop an off-screen person the viewer has not met on camera this episode. Prefer "your sister" / "the woman in the doorway" / "the one who sent the envelope" over a new proper name. If they must exist, put them in the doorway.
${DROP_IN_RULES}
- Hidden identity: one line that means one thing to her and another to us.
- One private tell per episode, under a second. Never write flashing eyes, gold-eye ECU, fangs, or a transform as a look. The rest is a real room.
- Take 1 first cue is the hook. Last cue of the last take is an unpaid question or a consequence starting.
- Keep the SAME speakers in the SAME order, including a third person. Keep 5–8 cues; do not drop below 5 if the take already had 5. Keep parentheticals, especially enters / leaves / tells.
- Do not open a take by repeating the previous take's last spoken line.
- Keep the story mechanism. Make the talk clearer, not different.
- Format each scene_script as lines "NAME: text" joined by \\n. That format is for the engine only. The video model never sees those labels.
Bible: ${JSON.stringify({ title: input.bible.title, logline: input.bible.logline, characters: input.bible.characters.map((row) => ({ name: row.name, description: row.description })) })}
Takes: ${JSON.stringify(input.takes)}
Return JSON: {"takes":[{"index":number,"scene_script":string}]}`,
        "60_90",
      );
      const rows = Array.isArray(out.takes) ? out.takes : [];
      return rows
        .filter((row): row is { index: number; scene_script: string } => {
          const script = row?.scene_script;
          return typeof row?.index === "number" && typeof script === "string" && script.trim().length > 0;
        })
        .map((row) => ({ index: row.index, scene_script: row.scene_script.trim() }));
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

/** Suggested names and gender for slate placeholders. Cheap: one short JSON object. */
export async function nameCastSlate(input: {
  title: string;
  idea: string;
  slots: Array<{ job: string; label: string; archetype: string; name?: string }>;
}): Promise<Array<{ job: string; name: string; gender: "woman" | "man" | null; note: string }>> {
  const body = await completeJson<{
    names?: Array<{ job?: string; name?: string; gender?: string; note?: string }>;
  }>(
    `Name only the speaking people on this short vertical drama. One adult fictional name and one gender per slot. No celebrities.
Never name an NDA, contract, DNA test, clause, deed, locket, ledger, or other object as if it were a person.
Gender must be woman or man and must match the brief and the role. Do not flip a contract wife into a man.
If a slot already has a name, keep that name and only fill gender and the one-line note.
Title: ${input.title}
Idea: ${input.idea}
Slots: ${JSON.stringify(input.slots)}
JSON: { "names": [{ "job": "engine"|"wall"|"witness"|"nuke", "name": "First Last", "gender": "woman"|"man", "note": "one line: adult woman or man and who they are" }] }`,
  );
  const rows = Array.isArray(body.names) ? body.names : [];
  return input.slots.map((slot) => {
    const hit = rows.find((row) => String(row.job ?? "") === slot.job);
    const rawGender = String(hit?.gender ?? "").trim().toLowerCase();
    const gender = rawGender === "woman" || rawGender === "female" ? "woman" : rawGender === "man" || rawGender === "male" ? "man" : null;
    const name = String(hit?.name ?? slot.name ?? "").trim().slice(0, 60);
    return {
      job: slot.job,
      name,
      gender,
      note: String(hit?.note ?? slot.archetype).trim().slice(0, 300),
    };
  });
}
