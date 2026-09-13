/**
 * New series, new bible, new stills, episode 1 scene takes.
 * Same createEngine path paying customers use. Writes under
 * assets/live/wolf-boss-hired-his-mate/ — never boss-delivery-v2.
 *
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --resume
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --plan-only
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --cut-only
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --resume --retake=1
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --resume --retake=2,3,4
 *   npx tsx scripts/shoot-wolf-boss-ep1.ts --resume --retake=all
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { expectedFacesFor, isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { scoreTake, type TakeAnalysis } from "../src/engine/pipeline/take-analysis.ts";
import { cueRows, cueText } from "../src/drama-engine/types/continuity.ts";
import { collapseSameSpeakerBreaths } from "../src/drama-engine/types/dialogue.ts";
import { talkProblems } from "../src/drama-engine/types/talk.ts";
import { unseenNamesInScript } from "../src/drama-engine/types/dialogue.ts";
import { peopleOnSceneTake } from "../src/drama-engine/craft/prompt-fragments.ts";
import { PRICE_SNAPSHOT_VERSION } from "../src/engine/config/models.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { Character, GenerationJob, Shot, StoryBible } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const OWNER_SOURCE_SERIES = "92d0a750-01a7-4800-97fe-10a16cafde72";
const OUT = resolve(process.cwd(), "assets", "live", "wolf-boss-hired-his-mate");
const STATE = resolve(OUT, "series.json");

const TITLE = "The Wolf Boss Hired His Mate";
const LOGLINE =
  "When will the courier he just hired learn that the parcel she opened was a pack-law mate claim — and that her new boss is the Alpha who already marked her?";
const IDEA = `A vertical micro drama. Primary tropes: werewolf mate + mafia protector. Secondaries: hidden identity, forced proximity, contract secretary.
Core expectation: when will the delivery driver he hired as his secretary learn that the parcel she opened was a pack-law mate claim, and that he is the city's hidden Alpha?

Nyla Rhee is twenty-six, a night courier paying her adult sister's hospital bill of forty-eight thousand. The sister is an adult, twenty-four, and does not appear in episode 1. Do not say her name. Say "my sister" / "your sister". Every named role is twenty-four or older. Strikingly beautiful phone-close face: warm-olive skin, dark almond eyes, a small beauty mark near the mouth, long black hair in a low knot. Loop-1 wardrobe: zipped black courier jacket over a high-neck black blouse, dark trousers. Clothes stay on. No open chest.

Roman Hale is thirty-two. On paper he owns a night club. He is the city's crime-family boss and the hidden Alpha of the urban pack. She does not know either secret. The audience does. Strikingly beautiful: pale-gold skin, sharp jaw, black hair swept back, pale green eyes. Loop-1 wardrobe: black suit jacket over a fully buttoned black shirt, dark trousers, no tie. Clothes stay on. No open chest.

Oren Vale is Roman's man, one step back, never in a lead's mark. Almost says "Alpha" and is cut off. A rival she-wolf exists later in the season; she does not appear in episode 1. Do not say her name.

Mechanism: Nyla is hired to deliver a sealed black envelope to Roman's private office. Pack law: that envelope is a mate-claim writ. A human who opens it is already claimed. She opened it because the desk name matched her new hire slip. Inside is a wax seal and a gold-thread mark with her name. Roman hires her as secretary on the spot to keep her under his roof before the rival pack smells the opened writ. He will cover the forty-eight thousand. She thinks he is buying her silence. He knows she is his mate.

Episode 1 is only the private office above the club, one night, one lamp. She is already inside. She drops the opened envelope on his desk. Hook in three seconds: "Your parcel. I opened it." They are against each other, then the hire, then the almost-slip, then one private tell she does not see, then an unpaid CPI. Leads meet in take 1. Both on screen.

Werewolf is legal. NEVER show a body changing. NEVER write a creature, a snout, fur, or a transformation. The wolf is one private tell after she looks away — under a second, then human eyes. Words do the rest. No gold-eye ECU. No bite on camera.

Locations for the season (4): the private office above the club at night (dark wood, one brass lamp, black desk, the opened black envelope with a wax seal); the courier depot at night; the pack house study in low lamp light; the hospital billing desk in daylight. Only the office appears in episode 1.

Clean public-decency romance: clothes stay on, no drugs, no nudity, no weapons, no crime in progress, no blood. Adults only. A charged almost-kiss and a drink on the desk are allowed. Casual spoken English. Contractions. Under 12 words. Name someone at most once per take. Do not name anyone who is not in the room. Prefer "my sister" / "your sister" / "the woman who wanted that envelope" over a new proper name. If a fourth person must exist, put them in the doorway with a full-page entrance and one identifying line. Every take must make sense to a viewer who just dropped in. Target lines: "Are you trying to bribe me?" "You opened it." "Don't play dumb." "I can't go there." "Then why pay my sister?" Never article voice or lore lecture: "this constitutes", "I am informing you", "the aforementioned", "this is pack law", "signed by my hand", "That was never a letter", "A claim.", "The black one, red wax."

Do not use the names Mara, Cole, Felix, Sarah, or David. Do not write an alley rescue. Do not write 4–8 second singles. Do not write voice over. Episode 1 is 4–6 continuous 10–15s scene takes with 5–8 spoken cues each (the button may be shorter).`;

const BUDGET_FLOOR = 35;
const HOOK_MUST_MATCH = /\b(opened|parcel|envelope|writ|desk|hire|hired|secretary|mark)\b/i;
const OLD_PLOT = /\b(mara|cole|felix|sarah|david|scissors|tuesday paper|laundromat|carrier|heiress|alley|kneels over|service alley)\b/i;
const BANNED_PROMPT =
  /\b(nude|naked|undress|celebrity|actor|actress|cocaine|shapeshift|snout|furred|creature morph|claiming bite|turns into a wolf|body changing|grows fur)\b/i;

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function orderedShots(engine: ReturnType<typeof createEngine>, episodeId: string): Shot[] {
  return engine.store
    .scenesFor(episodeId)
    .sort((a, b) => a.position - b.position)
    .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
}

/**
 * `speech_off_script` is hard: a take where the model invented its own dialogue
 * is not a rough take, it is a different scene, and the captions will show the
 * script over it. `speech_unchecked` is hard for the same reason — STT that
 * never ran means nothing verified the lines at all.
 */
const HARD_SCENE_TAKE_BLOCKERS = new Set([
  "modest_dress",
  "identity_drift",
  "native_audio_missing",
  "no_speech",
  "speech_off_script",
  "speech_unchecked",
]);

function bestUsableTake(
  store: ReturnType<typeof createEngine>["store"],
  shot: Shot,
  context?: { namedCast?: string[]; takeIndex?: number },
) {
  const ranked: Array<{ assetId: string; score: number; blockers: string[] }> = [];
  for (const job of store.jobs.values()) {
    if (job.shot_id !== shot.id || job.job_type !== "video") continue;
    const assetId = job.result_metadata.asset_id;
    if (typeof assetId !== "string") continue;
    const analysis = job.result_metadata.take_analysis as TakeAnalysis | undefined;
    const verdict = analysis
      ? scoreTake(analysis, {
          dialogueCu: true,
          lockedTake: false,
          sceneTake: true,
          expectedFaces: expectedFacesFor(shot.shot_data),
          expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
          // Without the script and transcript the scene-take checks — including
          // whether the model actually spoke the written lines — never run.
          takeIndex: context?.takeIndex ?? 0,
          transcript: analysis.transcript ?? null,
          namedCast: context?.namedCast ?? [],
          speakers: peopleOnSceneTake({
            sceneScript: shot.shot_data.scene_script,
            speaker: shot.shot_data.speaker,
            speakerOnCamera: shot.shot_data.speaker_on_camera,
            blocking: shot.shot_data.blocking,
          }),
          sceneScript: typeof shot.shot_data.scene_script === "string" ? shot.shot_data.scene_script : null,
        })
      : null;
    const blockers = verdict?.blockers ?? (Array.isArray(job.result_metadata.take_blockers) ? (job.result_metadata.take_blockers as string[]) : []);
    const score = verdict?.score ?? (typeof job.result_metadata.take_score === "number" ? job.result_metadata.take_score : 0);
    ranked.push({ assetId, score, blockers });
  }
  ranked.sort((a, b) => a.blockers.length - b.blockers.length || b.score - a.score);
  return ranked[0] ?? null;
}

function canKeepSceneTake(row: { blockers: string[] }): boolean {
  return row.blockers.every((reason) => !HARD_SCENE_TAKE_BLOCKERS.has(reason));
}

function isValidSceneTakePlan(shots: Shot[]): boolean {
  return shots.length >= 4 && shots.length <= 6 && shots.every((shot) => isSceneTake(shot.shot_data));
}

function leadNames(bible: StoryBible | null | undefined): string[] {
  return (bible?.characters ?? []).slice(0, 2).map((row) => row.name.split(/\s+/)[0] ?? row.name).filter(Boolean);
}

function planProblems(shots: Shot[], bible?: StoryBible | null): string[] {
  const problems: string[] = [];
  if (!isValidSceneTakePlan(shots)) problems.push(`not 4–6 scene takes (${shots.length})`);
  const blob = shots.map((shot) => `${shot.shot_data.scene_script ?? ""} ${shot.shot_data.blocking?.staging ?? ""}`).join("\n");
  const lower = blob.toLowerCase();
  if (OLD_PLOT.test(lower)) problems.push("leftover prior-series names or alley plot");
  if (BANNED_PROMPT.test(lower)) problems.push("banned nude/transform/celebrity language in the plan");
  const staged = shots.flatMap((shot) => talkProblems(shot.shot_data.scene_script));
  if (staged.length) problems.push(`staged talk (${staged.slice(0, 3).join(" / ")})`);
  if (!/\b(office|desk|envelope|parcel|lamp|chair|seat)\b/.test(lower)) problems.push("staging never mentions the office, desk, or parcel");
  const nonButton = shots.slice(0, -1);
  if (!nonButton.every((shot) => {
    const n = cueRows(shot.shot_data.scene_script).length;
    return n >= 5 && n <= 8;
  })) {
    problems.push("a non-button take is outside 5–8 cues");
  }
  if (!shots.every((shot) => shot.shot_data.blocking?.camera_left && shot.shot_data.blocking?.camera_right)) {
    problems.push("a take has no locked sides");
  }
  if (!shots.every((shot) => shot.shot_data.blocking?.staging?.trim())) problems.push("a take has no staging");
  const allCues = shots.flatMap((shot) => cueRows(shot.shot_data.scene_script));
  const button = allCues.at(-1);
  const norm = (row: string) =>
    row.replace(/^[^:]+:\s*/, "").replace(/\([^)]*\)/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const buttonSpoken = button ? norm(button) : "";
  if (button && buttonSpoken && allCues.slice(0, -1).some((row) => norm(row) === buttonSpoken)) {
    problems.push(`button line repeats an earlier cue ("${button}")`);
  }
  const met: string[] = [];
  const roster = [
    ...leadNames(bible),
    ...((bible?.characters ?? []).map((row) => row.name.split(/\s+/)[0] ?? row.name)),
  ].filter(Boolean);
  for (const shot of shots) {
    const onCamera = peopleOnSceneTake({
      sceneScript: shot.shot_data.scene_script,
      speaker: shot.shot_data.speaker,
      speakerOnCamera: shot.shot_data.speaker_on_camera,
      blocking: shot.shot_data.blocking,
    });
    const hits = unseenNamesInScript({
      script: shot.shot_data.scene_script,
      onCamera,
      metThisEpisode: met,
      namedCast: roster,
    });
    if (hits.length) problems.push(`unseen name ${hits[0]!.name} ("${hits[0]!.line}")`);
    if (/\bjuno\b/i.test(shot.shot_data.scene_script ?? "") && !onCamera.some((name) => /\bjuno\b/i.test(name))) {
      problems.push("names unseen Juno");
    }
    for (const name of onCamera) {
      const token = name.trim().split(/\s+/)[0] ?? "";
      if (token && !met.some((row) => row.toLowerCase() === token.toLowerCase())) met.push(token);
    }
  }
  const selfAddressed = allCues.filter((row) => {
    const name = row.split(":")[0]?.trim().split(/\s+/)[0];
    if (!name) return false;
    const line = row.replace(/^[^:]+:\s*/, "").replace(/\([^)]*\)/g, "").trim();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\s*,`, "i").test(line) && /\byou\b/i.test(line) && /\?\s*$/.test(line);
  });
  if (selfAddressed.length) problems.push(`a cue makes a speaker address themselves ("${selfAddressed[0]}")`);
  const hookScript = shots[0]?.shot_data.scene_script ?? "";
  if (!HOOK_MUST_MATCH.test(hookScript)) problems.push(`hook take never plays the opened parcel ("${cueRows(hookScript)[0] ?? ""}")`);
  const leads = leadNames(bible);
  if (leads.length >= 2) {
    const first = `${shots[0]?.shot_data.scene_script ?? ""} ${shots[0]?.shot_data.blocking?.present?.join(" ") ?? ""}`;
    const missing = leads.filter((name) => !new RegExp(`\\b${name}\\b`, "i").test(first));
    if (missing.length) problems.push(`take 1 is missing a lead (${missing.join(", ")})`);
  }
  return problems;
}

function enqueueActiveVideo(engine: ReturnType<typeof createEngine>, shots: Shot[]) {
  const shotIds = new Set(shots.map((shot) => shot.id));
  const queued = new Set(engine.store.queue.map((task) => task.job_id));
  for (const job of engine.store.jobs.values()) {
    if (!job.shot_id || !shotIds.has(job.shot_id) || job.job_type !== "video") continue;
    if (job.status !== "queued" && job.status !== "generating" && job.status !== "submitting") continue;
    if (queued.has(job.id)) continue;
    engine.store.queue.push({ id: `local-wolf-${job.id}`, job_id: job.id, kind: "generate", created_at: job.created_at, visible_at: new Date().toISOString() });
    queued.add(job.id);
  }
}

function paymentFailed(message: string): boolean {
  return /\b402\b/.test(message) || /insufficient|credits|payment required/i.test(message);
}

type State = { series_id: string; episode_id: string | null; owner_id: string };

function titleName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function closedWardrobe(name: string, current: string | null | undefined): string {
  const text = (current ?? "").trim();
  if (/\b(jacket|blazer|suit|coat|blouse|high-neck|turtleneck|buttoned)\b/i.test(text) && !/\b(open-?collar|unbutton|shirtless|low.?cut)\b/i.test(text)) {
    return text || "opaque contemporary clothes, closed at the throat";
  }
  if (/roman|oren|kira/i.test(name)) return "black suit jacket over a fully buttoned black shirt, dark trousers";
  return "zipped black jacket over a high-neck blouse, dark trousers";
}

function stillSafeCopy(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\b(crime|criminal|mafia|weapon|gun|blood|cocaine|drug|alpha|pack.?law|claimed mate|kill(?:s|ing|ed)?)\b/gi, "office")
    .replace(/\s+/g, " ")
    .trim();
}

function lockCastForStills(engine: ReturnType<typeof createEngine>, seriesId: string) {
  const series = engine.store.series.get(seriesId);
  const bible = series?.story_bible;
  if (bible) {
    engine.store.series.set(seriesId, {
      ...series!,
      story_bible: {
        ...bible,
        characters: bible.characters.map((row) => {
          const name = titleName(row.name);
          const wardrobe = closedWardrobe(name, row.appearance.default_wardrobe);
          return {
            ...row,
            name,
            description: stillSafeCopy(row.description) || row.description,
            voice_design_prompt: stillSafeCopy(row.voice_design_prompt) || row.voice_design_prompt,
            appearance: { ...row.appearance, default_wardrobe: wardrobe },
          };
        }),
      },
    });
  }
  for (const character of engine.store.charactersFor(seriesId)) {
    const name = titleName(character.name);
    const wardrobe = closedWardrobe(name, character.default_wardrobe || character.appearance_profile.default_wardrobe);
    engine.store.characters.set(character.id, {
      ...character,
      name,
      description: stillSafeCopy(character.description) || character.description,
      default_wardrobe: wardrobe,
      appearance_profile: { ...character.appearance_profile, default_wardrobe: wardrobe },
      voice_profile: {
        ...character.voice_profile,
        design_prompt: stillSafeCopy(character.voice_profile.design_prompt) || character.voice_profile.design_prompt,
      },
    });
  }
}

function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

async function dumpStill(
  assets: ReturnType<typeof createConfiguredAssetStore>,
  id: string | null | undefined,
  file: string,
): Promise<string | null> {
  if (!id) return null;
  const asset = await assets.get(id).catch(() => null);
  if (!asset) return null;
  const ext = asset.mime_type?.includes("png") ? "png" : "jpg";
  const path = resolve(OUT, "stills", `${file}.${ext}`);
  await mkdir(resolve(OUT, "stills"), { recursive: true });
  await writeFile(path, asset.body);
  return path;
}

async function dumpLocks(
  engine: ReturnType<typeof createEngine>,
  assets: ReturnType<typeof createConfiguredAssetStore>,
  state: State,
  shots: Shot[],
) {
  const series = engine.store.series.get(state.series_id);
  await writeFile(resolve(OUT, "bible.json"), JSON.stringify(series?.story_bible ?? null, null, 2));
  await writeFile(
    resolve(OUT, "plan.json"),
    JSON.stringify(
      {
        title: TITLE,
        logline: series?.story_bible?.logline ?? LOGLINE,
        takes: shots.map((shot) => ({
          id: shot.id,
          fn: shot.shot_data.function,
          dur: shot.shot_data.duration_hint_seconds,
          staging: shot.shot_data.blocking?.staging,
          upper: shot.shot_data.blocking?.upper_frame,
          present: shot.shot_data.blocking?.present,
          script: shot.shot_data.scene_script,
        })),
      },
      null,
      2,
    ),
  );
  for (const character of engine.store.charactersFor(state.series_id)) {
    const slug = slugName(character.name);
    for (const [kind, id] of Object.entries(character.visual_reference_asset_ids)) {
      await dumpStill(assets, id, `${slug}-${kind}`);
    }
    for (const [look, id] of Object.entries(character.wardrobe_asset_ids)) {
      await dumpStill(assets, id, `${slug}-wardrobe-${slugName(look)}`);
    }
  }
  for (const [location, id] of Object.entries(series?.location_refs ?? {})) {
    await dumpStill(assets, id, `location-${slugName(location.split("—")[0] ?? location)}`);
  }
}

async function main() {
  loadLocalEnv();
  const args = new Set(process.argv.slice(2));
  const cutOnly = args.has("--cut-only");
  const planOnly = args.has("--plan-only");
  const retakeToken = [...args].find((arg) => arg.startsWith("--retake="));
  const retakeRaw = retakeToken?.slice("--retake=".length) ?? "";
  const retakeAll = retakeRaw === "all";
  // "--retake=2,3,4" reshoots a set in one run instead of one remux per take.
  const retakeList = retakeAll
    ? []
    : retakeRaw
        .split(",")
        .map((row) => Number(row.trim()))
        .filter((row) => Number.isInteger(row) && row >= 1);
  const resume = cutOnly || args.has("--resume") || retakeList.length > 0 || retakeAll;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mkdir(OUT, { recursive: true });

  const { data: ownerRow } = await client.from("series").select("owner_id").eq("id", OWNER_SOURCE_SERIES).single();
  const ownerId = ownerRow?.owner_id;
  if (!ownerId) throw new Error("Could not resolve the owner account");

  const ai = createAiGateway({ stt: { transcribe: transcribeAudio } });
  let state: State | null = resume && existsSync(STATE) ? (JSON.parse(await readFile(STATE, "utf8")) as State) : null;
  let engine: ReturnType<typeof createEngine>;
  let assets: ReturnType<typeof createConfiguredAssetStore>;
  let baseAssets: Awaited<ReturnType<typeof loadSeriesStore>>["assets"] = [];

  if (state) {
    const loaded = await loadSeriesStore(client, state.series_id);
    assets = createConfiguredAssetStore();
    hydrateAssetStore(assets, loaded.assets);
    baseAssets = loaded.assets;
    engine = createEngine({ store: loaded.store, assets, skipSeriesBudget: true, ai, render: renderEpisodeBytes });
    engine.store.queue = [];
    process.stdout.write(`resuming series ${state.series_id}\n`);
  } else {
    assets = createConfiguredAssetStore();
    engine = createEngine({ assets, skipSeriesBudget: true, ai, render: renderEpisodeBytes });
    const series = await engine.createSeries({ owner_id: ownerId, title: TITLE, description: IDEA });
    process.stdout.write(`new series ${series.id}\n`);
    process.stdout.write("writing the bible…\n");
    let analyzed = false;
    for (let attempt = 0; attempt < 4 && !analyzed; attempt += 1) {
      try {
        await engine.analyze({ owner_id: ownerId, series_id: series.id });
        analyzed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/Minors are not allowed|fictional adults/i.test(message) || attempt === 3) throw error;
        process.stdout.write(`  bible blocked (${message}); rewriting ${attempt + 2}/4…\n`);
      }
    }
    const withBible = engine.store.series.get(series.id)!;
    engine.store.series.set(series.id, {
      ...withBible,
      title: TITLE,
      story_bible: withBible.story_bible
        ? { ...withBible.story_bible, title: TITLE, logline: withBible.story_bible.logline || LOGLINE }
        : withBible.story_bible,
      style_profile: { ...withBible.style_profile, episode_length: "60_90" },
    });
    lockCastForStills(engine, series.id);
    process.stdout.write(
      `${JSON.stringify(
        {
          characters: engine.store.charactersFor(series.id).map((row: Character) => ({
            name: row.name,
            wardrobe: row.default_wardrobe,
            description: row.description.slice(0, 160),
          })),
          locations: engine.store.series.get(series.id)?.story_bible?.locations,
          logline: engine.store.series.get(series.id)?.story_bible?.logline,
        },
        null,
        2,
      )}\n`,
    );
    state = { series_id: series.id, episode_id: null, owner_id: ownerId };
    await writeFile(STATE, JSON.stringify(state, null, 2));
  }

  const persistEarly = async () => {
    await commitSeriesStore(client, engine.store, state!.series_id, assets.snapshot?.() ?? baseAssets);
  };

  if (!state!.episode_id || engine.store.charactersFor(state!.series_id).some((row) => !row.locked)) {
    lockCastForStills(engine, state!.series_id);
    await persistEarly();
    for (const character of engine.store.charactersFor(state!.series_id)) {
      if (character.locked) continue;
      process.stdout.write(`locking ${character.name}…\n`);
      await engine.lockCharacter({ owner_id: ownerId, character_id: character.id, face_only: true });
      await persistEarly();
    }
    process.stdout.write("locking locations…\n");
    await engine.lockLocations({ owner_id: ownerId, series_id: state!.series_id });
    if (!state!.episode_id) {
      const episode = await engine.createEpisode({
        owner_id: ownerId,
        series_id: state!.series_id,
        episode_number: 1,
        title: "The Parcel She Opened",
      });
      state = { ...state!, episode_id: episode.id };
      await writeFile(STATE, JSON.stringify(state, null, 2));
    }
    await persistEarly();
  }
  if (!state!.episode_id) throw new Error("Episode 1 was not created");
  const episodeId = state!.episode_id;

  const balance = (await client.from("project_ledger").select("entry_type, amount").eq("series_id", state.series_id)).data ?? [];
  const available = balance.reduce(
    (sum, row) => sum + (row.entry_type === "reserve" || row.entry_type === "settle" ? -Number(row.amount) : Number(row.amount)),
    0,
  );
  if (available < BUDGET_FLOOR) {
    const topUp = Math.ceil(BUDGET_FLOOR - available);
    const { error } = await client.from("project_ledger").insert({
      owner_id: ownerId,
      series_id: state.series_id,
      entry_type: "purchase",
      amount: topUp,
      generation_job_id: null,
      stripe_event_id: `wolf_ep1_topup_${Date.now()}`,
      price_snapshot_version: PRICE_SNAPSHOT_VERSION,
    });
    if (error) throw new Error(error.message);
    process.stdout.write(`ledger balance $${available.toFixed(2)}; topped up $${topUp}\n`);
    const reloaded = await loadSeriesStore(client, state.series_id);
    engine.store.ledger.splice(0, engine.store.ledger.length, ...reloaded.store.ledger);
  }

  const commit = async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await commitSeriesStore(client, engine.store, state!.series_id, assets.snapshot?.() ?? baseAssets);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 4 || !/fetch failed|ECONNRESET|ETIMEDOUT|socket|network|timeout/i.test(message)) throw error;
        process.stdout.write(`  commit failed (${message.split("\n")[0]}); retrying ${attempt}/3\n`);
        await sleep(5_000 * attempt);
      }
    }
  };
  await commit();

  let shots = orderedShots(engine, episodeId);
  enqueueActiveVideo(engine, shots);
  const bible = engine.store.series.get(state.series_id)?.story_bible ?? null;
  const replan = args.has("--replan");
  if (!cutOnly && (!resume || replan || !isValidSceneTakePlan(shots) || planProblems(shots, bible).length > 0)) {
    const planAttempts = 6;
    for (let attempt = 0; attempt < planAttempts; attempt += 1) {
      process.stdout.write(`planning episode 1 (attempt ${attempt + 1}/${planAttempts})…\n`);
      let problems: string[];
      try {
        const planned = await engine.planEpisode({ owner_id: ownerId, episode_id: episodeId, episode_length: "60_90" });
        shots = [...planned.scenes]
          .sort((a, b) => a.position - b.position)
          .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
        problems = planProblems(shots, engine.store.series.get(state.series_id)?.story_bible);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (paymentFailed(message) && !/in-flight/i.test(message)) throw error;
        if (/in-flight/i.test(message)) {
          process.stdout.write("  planner rate-limited; waiting 2 minutes for in-flight requests to settle\n");
          await sleep(130_000);
        }
        problems = [`planner error: ${message.split("\n")[0]}`];
      }
      if (!problems.length) break;
      process.stdout.write(`  plan rejected: ${problems.join("; ")}\n`);
      if (attempt === planAttempts - 1) throw new Error(`Plan failed the gates ${planAttempts} times: ${problems.join("; ")}`);
    }
  }

  const retakeIndexes = retakeAll ? shots.map((_, index) => index) : retakeList.map((row) => row - 1);
  for (const takeIndex of retakeIndexes) {
    const shot = shots[takeIndex];
    if (!shot) throw new Error(`No take ${takeIndex + 1} to reshoot`);
    if (cutOnly) {
      const latest = [...engine.store.jobs.values()]
        .filter(
          (job) =>
            job.shot_id === shot.id &&
            job.job_type === "video" &&
            job.status === "completed" &&
            typeof job.result_metadata.asset_id === "string",
        )
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
      const keep = typeof latest?.result_metadata.asset_id === "string" ? latest.result_metadata.asset_id : null;
      if (!keep) throw new Error(`No completed video for take ${takeIndex + 1} to pin`);
      for (const row of shot.shot_data.take_reviews ?? []) {
        if (row.decision === "approve" && row.asset_id !== keep) {
          await engine.reviewTake({
            owner_id: ownerId,
            shot_id: shot.id,
            asset_id: row.asset_id,
            decision: "reject",
            note: "replaced by retake",
          });
        }
      }
      await engine.reviewTake({
        owner_id: ownerId,
        shot_id: shot.id,
        asset_id: keep,
        decision: "approve",
        note: "keep the retake",
      });
      shots = orderedShots(engine, episodeId);
      process.stdout.write(`pin take ${takeIndex + 1} to ${keep} (${latest?.id})\n`);
    } else {
      const source = cueRows(shot.shot_data.scene_script);
      const collapsed = collapseSameSpeakerBreaths(source);
      const rows = collapsed.length >= 5 || /button/i.test(shot.shot_data.function ?? "") ? collapsed : source;
      const next: Shot = {
        ...shot,
        status: "planned",
        selected_generation_id: null,
        shot_data: {
          ...shot.shot_data,
          scene_script: rows.join("\n"),
          dialogue: cueText(rows[0] ?? shot.shot_data.dialogue ?? ""),
          scene_take_strip: undefined,
          take_analysis: null,
          line_revision: (shot.shot_data.line_revision ?? 0) + 1,
        },
      };
      engine.store.shots.set(shot.id, next);
      shots = shots.map((row, index) => (index === takeIndex ? next : row));
      process.stdout.write(`retake ${takeIndex + 1}: reset ${shot.id}\n${rows.join("\n")}\n`);
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        title: TITLE,
        takes: shots.map((shot) => ({
          fn: shot.shot_data.function,
          dur: shot.shot_data.duration_hint_seconds,
          staging: shot.shot_data.blocking?.staging,
          upper: shot.shot_data.blocking?.upper_frame,
          present: shot.shot_data.blocking?.present,
          script: shot.shot_data.scene_script,
        })),
      },
      null,
      2,
    )}\n`,
  );
  const problems = planProblems(shots, engine.store.series.get(state.series_id)?.story_bible);
  if (problems.length) throw new Error(`Refusing to spend Seedance: ${problems.join("; ")}`);
  await dumpLocks(engine, assets, state, shots);
  await commit();
  if (planOnly) {
    process.stdout.write(`plan-only: bible, stills, and plan written under ${OUT}\n`);
    return;
  }

  for (const [index, shot] of cutOnly ? [] : shots.entries()) {
    process.stdout.write(`shoot ${index + 1}/${shots.length} ${shot.shot_data.function} ${shot.shot_data.duration_hint_seconds}s ${shot.shot_data.dialogue ?? ""}\n`);
    const started = Date.now();
    const startedAt = started;
    let lastBeat = started;
    let extraAttempts = 0;
    const forceFresh = retakeAll || retakeList.includes(index + 1);
    let generatedThisRun = false;
    while (Date.now() - started < 50 * 60 * 1000) {
      enqueueActiveVideo(engine, shots);
      await engine.tick();
      await commit();
      const live = engine.store.shots.get(shot.id);
      if (live?.status === "complete" && (!forceFresh || generatedThisRun)) {
        if (forceFresh && generatedThisRun && live.selected_generation_id) {
          const keep = live.selected_generation_id;
          for (const row of live.shot_data.take_reviews ?? []) {
            if (row.decision === "approve" && row.asset_id !== keep) {
              await engine.reviewTake({
                owner_id: ownerId,
                shot_id: shot.id,
                asset_id: row.asset_id,
                decision: "reject",
                note: "replaced by retake",
              });
            }
          }
          await engine.reviewTake({
            owner_id: ownerId,
            shot_id: shot.id,
            asset_id: keep,
            decision: "approve",
            note: "keep the retake",
          });
          await commit();
        }
        const takeId = engine.store.shots.get(shot.id)?.selected_generation_id ?? live.selected_generation_id;
        if (takeId) {
          const take = await assets.get(takeId).catch(() => null);
          if (take) {
            const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
            await writeFile(resolve(OUT, name), take.body);
            process.stdout.write(`  wrote ${name} ${take.body.byteLength} bytes\n`);
          }
        }
        break;
      }
      const inflight = [...engine.store.jobs.values()].some(
        (job: GenerationJob) =>
          job.shot_id === shot.id &&
          job.job_type === "video" &&
          (job.status === "queued" || job.status === "generating" || job.status === "ingesting" || job.status === "qc"),
      );
      if (inflight) {
        if (Date.now() - lastBeat > 60_000) {
          lastBeat = Date.now();
          process.stdout.write(`  …still rendering ${shot.id} (${Math.round((Date.now() - startedAt) / 1000)}s)\n`);
        }
        await sleep(8000);
        continue;
      }
      const usable = live
        ? bestUsableTake(engine.store, live, {
            namedCast: engine.store.charactersFor(state.series_id).map((row) => row.name),
            takeIndex: index,
          })
        : null;
      if (
        !forceFresh &&
        live &&
        usable &&
        canKeepSceneTake(usable) &&
        (live.status === "needs_review" || live.status === "planned" || live.status === "generating")
      ) {
        process.stdout.write(`  approving ${usable.assetId} (score ${usable.score}, blockers ${usable.blockers.join(",") || "none"})\n`);
        await engine.reviewTake({ owner_id: ownerId, shot_id: shot.id, asset_id: usable.assetId, decision: "approve", note: "keep the full-length scene take" });
        await commit();
        continue;
      }
      if (usable && !canKeepSceneTake(usable)) {
        process.stdout.write(`  take ${usable.assetId} blocked (${usable.blockers.join(",")}); shooting another\n`);
      }
      if (extraAttempts < 4 && live?.status !== "complete" && (forceFresh || !usable || !canKeepSceneTake(usable))) {
        extraAttempts += 1;
        process.stdout.write(`  ${live?.status ?? "missing"} ${shot.id} — generating (attempt ${extraAttempts}/4)\n`);
        const pinned = engine.store.shots.get(shot.id);
        if (pinned?.shot_data.scene_take_strip) {
          engine.store.shots.set(shot.id, { ...pinned, shot_data: { ...pinned.shot_data, scene_take_strip: undefined } });
        }
        try {
          const { job } = await engine.generateVideo({ owner_id: ownerId, shot_id: shot.id, quality: "maximum" });
          generatedThisRun = true;
          process.stdout.write(`  job ${job.id} ${job.model} $${job.estimated_cost ?? "?"}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (paymentFailed(message)) throw new Error(`Stopped on 402: ${message}`);
          if (/SensitiveContentDetected|PrivacyInformation/i.test(message)) {
            if (extraAttempts >= 4) throw new Error(`Classifier rejected every reference pack for ${shot.id}: ${message}`);
            process.stdout.write(`  classifier refused the reference pack; retrying (${extraAttempts}/4)\n`);
            await sleep(25_000 * extraAttempts);
            continue;
          }
          const transient =
            /HTTP 500|HTTP 502|HTTP 503|HTTP 504|HTTP 520|Internal Server Error|fetch failed|ECONNRESET|ETIMEDOUT|timed out|timeout while fetching|resource download failed|not valid: resource|image_url/i.test(
              message,
            );
          if (transient && extraAttempts < 4) {
            process.stdout.write(`  transient submit, will retry (${extraAttempts}/4)\n`);
            await sleep(12_000 * extraAttempts);
            continue;
          }
          throw error;
        }
        await commit();
      }
      // Retries are bounded. Spinning to the 50-minute timeout burns the run and
      // still ships nothing, so take the best of what we shot and flag it.
      if (extraAttempts >= 4 && usable && live?.status !== "complete") {
        process.stdout.write(
          `  keeping best of ${extraAttempts} takes for ${shot.id} (blockers ${usable.blockers.join(",") || "none"})\n`,
        );
        await engine.reviewTake({
          owner_id: ownerId,
          shot_id: shot.id,
          asset_id: usable.assetId,
          decision: "approve",
          note: `best of ${extraAttempts} takes; unresolved: ${usable.blockers.join(",") || "none"}`,
        });
        await commit();
        continue;
      }
      await sleep(8000);
    }
    const done = engine.store.shots.get(shot.id);
    if (done?.status !== "complete") throw new Error(`Shot ${shot.id} ended ${done?.status ?? "missing"}`);
  }

  process.stdout.write("cutting episode 1…\n");
  const rendered = await engine.renderEpisode({ owner_id: ownerId, episode_id: episodeId });
  await commit();
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, shot] of orderedShots(engine, episodeId).entries()) {
    const takeId = shot.selected_generation_id;
    if (!takeId) continue;
    const take = await assets.get(takeId).catch(() => null);
    if (!take) continue;
    const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
    await writeFile(resolve(OUT, name), take.body);
    rows.push({
      file: name,
      function: shot.shot_data.function,
      duration: shot.shot_data.duration_hint_seconds,
      staging: shot.shot_data.blocking?.staging,
      script: shot.shot_data.scene_script,
    });
  }
  if (rendered.asset) {
    const finalBytes = await assets.get(rendered.asset.id).catch(() => null);
    if (finalBytes) await writeFile(resolve(OUT, "ep1.mp4"), finalBytes.body);
  }
  await dumpLocks(engine, assets, state, orderedShots(engine, episodeId));
  await writeFile(resolve(OUT, "LIST.json"), JSON.stringify({ title: TITLE, logline: LOGLINE, series: state, rows }, null, 2));
  process.stdout.write(`READY · ${rows.length} scenes + ${resolve(OUT, "ep1.mp4")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
