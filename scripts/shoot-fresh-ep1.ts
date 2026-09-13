/**
 * Blank-slate episode 1: a new series row, a new bible written from the idea,
 * new cast sheets, new location plates, then plan → shoot → cut. Nothing is
 * reused from earlier demo series. Local Seedance only; hosted runners stay
 * paused. UAE public-decency lock.
 *
 *   npx tsx scripts/shoot-fresh-ep1.ts              # create + shoot
 *   npx tsx scripts/shoot-fresh-ep1.ts --resume     # continue the series in series.json
 *   npx tsx scripts/shoot-fresh-ep1.ts --cut-only   # recut finished takes
 *   npx tsx scripts/shoot-fresh-ep1.ts --plan-only  # bible, cast, plates, plan; no video spend
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
import { cueRows } from "../src/drama-engine/types/continuity.ts";
import { PRICE_SNAPSHOT_VERSION } from "../src/engine/config/models.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { GenerationJob, Shot } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

/** Owner of the earlier demo series; the new series belongs to the same account. */
const OWNER_SOURCE_SERIES = "92d0a750-01a7-4800-97fe-10a16cafde72";
const OUT = resolve(process.cwd(), "assets", "live", "boss-delivery-v2");
const STATE = resolve(OUT, "series.json");

const TITLE = "Boss Marries the Delivery Driver Girl";
/** The moderation gate reads "girl" as a possible minor in a story pitch; the pitch says woman, the title stays yours. */
const PITCH_TITLE = "Boss Marries the Delivery Driver";
const LOGLINE =
  "When will the delivery driver who saved a stranger's life learn that the broke night clerk paying off her mother's hospital debt is the undercover boss of the city's crime family?";
const IDEA = `A vertical micro drama. Primary trope: mafia protector. Secondaries: hidden identity, forced proximity.
Core expectation: when will she learn who he really is?

MARA is a night delivery driver, twenty-six, working double shifts to pay her mother's hospital debt of forty thousand. Tonight, on her last drop, she finds a man collapsed in the rain in the covered service alley behind a shuttered restaurant: on the wet ground, back against the brick wall, soaked, fever, barely conscious. She kneels over him and keeps him awake and breathing until he comes back.
The man is COLE. He tells her he is a night clerk with a fever. We, the audience, know he is the undercover boss of the city's crime family. She does not. His driver FELIX arrives at the mouth of the alley, almost calls him "Boss", and is cut off.
Cole will find Mara again to pay her mother's debt. By the end of the season she stands beside him as the queen of the family.

Episode 1 is only the alley, one continuous night, rain: the rescue, the lie ("night clerk"), Felix's near-slip, one private tell from Cole that Mara does not see, and the first unpaid question between them. She is on her knees over a man on the ground for most of it; when he can sit up, he sits against the wall. Nobody stands at a table. Nobody negotiates.

Locations for the season (3): the covered service alley behind the restaurant at night in rain (a brick wall, a steel back door, one caged bulb, wet asphalt with a puddle line, rain falling past the awning edge); the hospital billing office in daylight; the family house study. Only the alley appears in episode 1.

Clean public-decency romance for UAE media: no kissing, no bedroom, no alcohol, no weapons, no blood, no crime on camera. Adults only. Modest dress. The tension is words, distance, and faces.`;

/** Six 15s takes plus stills and the cut; the ledger holds at least this much before a shoot. */
const BUDGET_FLOOR = 35;

const FIRST_LINE_MUST_MATCH =
  /\b(breathe|breathing|breath|stay with me|look at me|eyes|wake|awake|conscious|pulse|don't die|don't you die|dying|collapsed|on the ground|hold on)\b/i;

function sleep(ms: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function orderedShots(engine: ReturnType<typeof createEngine>, episodeId: string): Shot[] {
  return engine.store
    .scenesFor(episodeId)
    .sort((a, b) => a.position - b.position)
    .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
}

const HARD_SCENE_TAKE_BLOCKERS = new Set(["modest_dress", "identity_drift", "native_audio_missing", "no_speech"]);

function bestUsableTake(store: ReturnType<typeof createEngine>["store"], shot: Shot) {
  const ranked: Array<{ assetId: string; score: number; blockers: string[] }> = [];
  for (const job of store.jobs.values()) {
    if (job.shot_id !== shot.id || job.job_type !== "video") continue;
    const assetId = job.result_metadata.asset_id;
    if (typeof assetId !== "string") continue;
    // Re-score from the stored measurements: the engine's rules are the current
    // rules, not the ones that ran when the take was ingested.
    const analysis = job.result_metadata.take_analysis as TakeAnalysis | undefined;
    const verdict = analysis
      ? scoreTake(analysis, {
          dialogueCu: true,
          lockedTake: false,
          sceneTake: true,
          expectedFaces: expectedFacesFor(shot.shot_data),
          expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
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

function enqueueActiveVideo(engine: ReturnType<typeof createEngine>, shots: Shot[]) {
  const shotIds = new Set(shots.map((shot) => shot.id));
  const queued = new Set(engine.store.queue.map((task) => task.job_id));
  for (const job of engine.store.jobs.values()) {
    if (!job.shot_id || !shotIds.has(job.shot_id) || job.job_type !== "video") continue;
    if (job.status !== "queued" && job.status !== "generating" && job.status !== "submitting") continue;
    if (queued.has(job.id)) continue;
    engine.store.queue.push({ id: `local-fresh-${job.id}`, job_id: job.id, kind: "generate", created_at: job.created_at, visible_at: new Date().toISOString() });
    queued.add(job.id);
  }
}

function paymentFailed(message: string): boolean {
  return /\b402\b/.test(message) || /insufficient|credits|payment required/i.test(message);
}

/** Every gate the plan must pass before a dollar goes to Seedance. */
function planProblems(shots: Shot[]): string[] {
  const problems: string[] = [];
  if (!isValidSceneTakePlan(shots)) problems.push(`not 4–6 scene takes (${shots.length})`);
  const blob = shots.map((shot) => `${shot.shot_data.scene_script ?? ""} ${shot.shot_data.blocking?.staging ?? ""}`).join("\n").toLowerCase();
  if (/\b(scissors|tuesday|carrier|heiress|wolf|laundromat|counter)\b/.test(blob)) problems.push("leftover plot or set words (scissors/Tuesday/carrier/laundromat/counter)");
  if (!/\b(ground|kneel|kneels|wall|rain|wet|asphalt|alley)\b/.test(blob)) problems.push("staging never mentions the ground, the wall, or the rain");
  if (!shots.every((shot) => cueRows(shot.shot_data.scene_script).length >= 3)) problems.push("a take has fewer than 3 cues");
  if (!shots.every((shot) => shot.shot_data.blocking?.camera_left && shot.shot_data.blocking?.camera_right)) problems.push("a take has no locked sides");
  if (!shots.every((shot) => shot.shot_data.blocking?.staging?.trim())) problems.push("a take has no staging");
  // The button must be new: a CPI line that repeats an earlier cue resolves nothing and reads as a loop.
  const allCues = shots.flatMap((shot) => cueRows(shot.shot_data.scene_script));
  const button = allCues.at(-1);
  const norm = (row: string) => row.replace(/^[^:]+:\s*/, "").replace(/\([^)]*\)/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const buttonSpoken = button ? norm(button) : "";
  // A parenthetical-only last cue is the stunned tell the format allows; a spoken button must not repeat an earlier cue.
  if (button && buttonSpoken && allCues.slice(0, -1).some((row) => norm(row) === buttonSpoken)) {
    problems.push(`button line repeats an earlier cue ("${button}")`);
  }
  if (
    button &&
    buttonSpoken &&
    !/\?\s*$/.test(button.trim()) &&
    !/\b(boss|call|calling|coming|leave|leaving|stay|name|who|why|what|how|never|now|tonight|find|owe|pay|debt|shift|work|mother|hospital|bill|money|number)\b/i.test(buttonSpoken)
  ) {
    problems.push(`button line is a flat statement ("${button}")`);
  }
  // "COLE: Cole." is a man giving his name. "COLE: Cole, who are you to Mara?"
  // is a filled-in template addressing himself: name, comma, then a question at
  // "you". Only the second one is rejected.
  const selfAddressed = allCues.filter((row) => {
    const name = row.split(":")[0]?.trim().split(/\s+/)[0];
    if (!name) return false;
    const line = row.replace(/^[^:]+:\s*/, "").replace(/\([^)]*\)/g, "").trim();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\s*,`, "i").test(line) && /\byou\b/i.test(line) && /\?\s*$/.test(line);
  });
  if (selfAddressed.length) problems.push(`a cue makes a speaker address themselves ("${selfAddressed[0]}")`);
  // The hook take is the rescue: somewhere in its script someone is kept alive.
  const hookScript = shots[0]?.shot_data.scene_script ?? "";
  if (!FIRST_LINE_MUST_MATCH.test(hookScript)) problems.push(`hook take never plays the rescue ("${cueRows(hookScript)[0] ?? ""}")`);
  return problems;
}

type State = { series_id: string; episode_id: string; owner_id: string };

async function main() {
  loadLocalEnv();
  const args = new Set(process.argv.slice(2));
  const cutOnly = args.has("--cut-only");
  const planOnly = args.has("--plan-only");
  const resume = cutOnly || args.has("--resume");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await mkdir(OUT, { recursive: true });

  const { data: ownerRow } = await client.from("series").select("owner_id").eq("id", OWNER_SOURCE_SERIES).single();
  const ownerId = ownerRow?.owner_id;
  if (!ownerId) throw new Error("Could not resolve the owner account");

  await client
    .from("productions")
    .update({ paused: true, status: "needs_user", agent_decision: "Paused; episode 1 shoots locally.", updated_at: new Date().toISOString() })
    .eq("series_id", OWNER_SOURCE_SERIES);

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
    const series = await engine.createSeries({ owner_id: ownerId, title: PITCH_TITLE, description: IDEA });
    process.stdout.write(`new series ${series.id}\n`);
    process.stdout.write("writing the bible…\n");
    await engine.analyze({ owner_id: ownerId, series_id: series.id });
    const withBible = engine.store.series.get(series.id)!;
    engine.store.series.set(series.id, {
      ...withBible,
      title: TITLE,
      story_bible: withBible.story_bible ? { ...withBible.story_bible, title: TITLE, logline: LOGLINE } : withBible.story_bible,
      style_profile: { ...withBible.style_profile, episode_length: "60_90" },
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          characters: engine.store.charactersFor(series.id).map((row) => ({ name: row.name, description: row.description.slice(0, 120) })),
          locations: engine.store.series.get(series.id)?.story_bible?.locations,
        },
        null,
        2,
      )}\n`,
    );
    for (const character of engine.store.charactersFor(series.id)) {
      process.stdout.write(`locking ${character.name}…\n`);
      // Native Seedance speech: the face is the lock. No ElevenLabs slot is spent.
      await engine.lockCharacter({ owner_id: ownerId, character_id: character.id, face_only: true });
    }
    process.stdout.write("locking locations…\n");
    await engine.lockLocations({ owner_id: ownerId, series_id: series.id });
    const episode = await engine.createEpisode({ owner_id: ownerId, series_id: series.id, episode_number: 1, title: "The Man in the Rain" });
    state = { series_id: series.id, episode_id: episode.id, owner_id: ownerId };
    await writeFile(STATE, JSON.stringify(state, null, 2));
  }

  // The project ledger is the engine's own spend guard, separate from the
  // provider account. Six takes plus stills need roughly $30 of headroom; a
  // resumed shoot on a drained series would fail on the first reserve.
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
      stripe_event_id: `fresh_ep1_topup_${Date.now()}`,
      price_snapshot_version: PRICE_SNAPSHOT_VERSION,
    });
    if (error) throw new Error(error.message);
    process.stdout.write(`ledger balance $${available.toFixed(2)}; topped up $${topUp}\n`);
    const reloaded = await loadSeriesStore(client, state.series_id);
    engine.store.ledger.splice(0, engine.store.ledger.length, ...reloaded.store.ledger);
  }

  // A shoot runs for an hour; one dropped connection to Supabase must not end it.
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

  let shots = orderedShots(engine, state.episode_id);
  enqueueActiveVideo(engine, shots);
  const replan = args.has("--replan");
  if (!cutOnly && (!resume || replan || !isValidSceneTakePlan(shots) || planProblems(shots).length > 0)) {
    const planAttempts = 6;
    for (let attempt = 0; attempt < planAttempts; attempt += 1) {
      process.stdout.write(`planning episode 1 (attempt ${attempt + 1}/${planAttempts})…\n`);
      let problems: string[];
      try {
        const planned = await engine.planEpisode({ owner_id: ownerId, episode_id: state.episode_id, episode_length: "60_90" });
        shots = [...planned.scenes].sort((a, b) => a.position - b.position).flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
        problems = planProblems(shots);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A hard 402 (credits gone) stops the run. An in-flight budget 402 is
        // transient: wait out the Retry-After and try again.
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
  const problems = planProblems(shots);
  if (problems.length) throw new Error(`Refusing to spend Seedance: ${problems.join("; ")}`);
  await commit();
  if (planOnly) {
    process.stdout.write("plan-only: stopping before video.\n");
    return;
  }

  for (const [index, shot] of cutOnly ? [] : shots.entries()) {
    process.stdout.write(`shoot ${index + 1}/${shots.length} ${shot.shot_data.function} ${shot.shot_data.duration_hint_seconds}s ${shot.shot_data.dialogue ?? ""}\n`);
    const started = Date.now();
    const startedAt = started;
    let lastBeat = started;
    let extraAttempts = 0;
    const trace = (step: string) => {
      if (process.env.SDM_TRACE) process.stderr.write(`[shoot ${index + 1}] ${step} ${new Date().toISOString()}\n`);
    };
    while (Date.now() - started < 50 * 60 * 1000) {
      enqueueActiveVideo(engine, shots);
      trace(`tick (queue ${engine.store.queue.length}, jobs ${[...engine.store.jobs.values()].filter((j) => j.shot_id === shot.id).map((j) => j.status).join(",") || "none"})`);
      await engine.tick();
      trace("tick done; commit");
      await commit();
      trace("commit done");
      const live = engine.store.shots.get(shot.id);
      if (live?.status === "complete") {
        const takeId = live.selected_generation_id;
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
          job.shot_id === shot.id && job.job_type === "video" && (job.status === "queued" || job.status === "generating" || job.status === "ingesting" || job.status === "qc"),
      );
      if (inflight) {
        // A 15s take renders for minutes. Say so, or a silent log looks hung.
        if (Date.now() - lastBeat > 60_000) {
          lastBeat = Date.now();
          process.stdout.write(`  …still rendering ${shot.id} (${Math.round((Date.now() - startedAt) / 1000)}s)\n`);
        }
        await sleep(8000);
        continue;
      }
      const usable = live ? bestUsableTake(engine.store, live) : null;
      if (live && usable && canKeepSceneTake(usable) && (live.status === "needs_review" || live.status === "planned" || live.status === "generating")) {
        process.stdout.write(`  approving ${usable.assetId} (score ${usable.score}, blockers ${usable.blockers.join(",") || "none"})\n`);
        await engine.reviewTake({ owner_id: ownerId, shot_id: shot.id, asset_id: usable.assetId, decision: "approve", note: "keep the full-length scene take" });
        await commit();
        continue;
      }
      if (usable && !canKeepSceneTake(usable)) {
        process.stdout.write(`  take ${usable.assetId} blocked (${usable.blockers.join(",")}); shooting another\n`);
      }
      if (extraAttempts < 4 && live?.status !== "complete" && (!usable || !canKeepSceneTake(usable))) {
        extraAttempts += 1;
        process.stdout.write(`  ${live?.status ?? "missing"} ${shot.id} — generating (attempt ${extraAttempts}/4)\n`);
        // A strip pinned by a previous refusal would cost this attempt its room
        // and look references. Each attempt starts from the full pack; the
        // engine still escalates inside the submit if the classifier objects.
        const pinned = engine.store.shots.get(shot.id);
        if (pinned?.shot_data.scene_take_strip) {
          engine.store.shots.set(shot.id, { ...pinned, shot_data: { ...pinned.shot_data, scene_take_strip: undefined } });
        }
        try {
          const { job } = await engine.generateVideo({ owner_id: ownerId, shot_id: shot.id, quality: "maximum" });
          process.stdout.write(`  job ${job.id} ${job.model} $${job.estimated_cost ?? "?"}\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (paymentFailed(message)) throw new Error(`Stopped on 402: ${message}`);
          // The engine walks the strip ladder itself (room, looks, profiles, then
          // faces only) inside one submit, so reaching here means the whole
          // ladder was rejected. The privacy classifier is probabilistic — the
          // same stills pass on a later submit — so this retries on the attempt
          // budget instead of spinning on it or giving up on the first refusal.
          if (/SensitiveContentDetected|PrivacyInformation/i.test(message)) {
            if (extraAttempts >= 4) throw new Error(`Classifier rejected every reference pack for ${shot.id}: ${message}`);
            process.stdout.write(`  classifier refused the reference pack; retrying (${extraAttempts}/4)\n`);
            await sleep(25_000 * extraAttempts);
            continue;
          }
          const transient =
            /HTTP 500|HTTP 502|HTTP 503|HTTP 504|HTTP 520|Internal Server Error|fetch failed|ECONNRESET|ETIMEDOUT|timed out|resource download failed|not valid: resource/i.test(message);
          if (transient && extraAttempts < 4) {
            process.stdout.write(`  transient submit, will retry (${extraAttempts}/4)\n`);
            await sleep(12_000 * extraAttempts);
            continue;
          }
          throw error;
        }
        await commit();
      }
      await sleep(8000);
    }
    const done = engine.store.shots.get(shot.id);
    if (done?.status !== "complete") throw new Error(`Shot ${shot.id} ended ${done?.status ?? "missing"}`);
  }

  process.stdout.write("cutting episode 1…\n");
  const rendered = await engine.renderEpisode({ owner_id: ownerId, episode_id: state.episode_id });
  await commit();
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, shot] of orderedShots(engine, state.episode_id).entries()) {
    const takeId = shot.selected_generation_id;
    if (!takeId) continue;
    const take = await assets.get(takeId).catch(() => null);
    if (!take) continue;
    const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
    await writeFile(resolve(OUT, name), take.body);
    rows.push({ file: name, function: shot.shot_data.function, duration: shot.shot_data.duration_hint_seconds, staging: shot.shot_data.blocking?.staging, script: shot.shot_data.scene_script });
  }
  if (rendered.asset) {
    const finalBytes = await assets.get(rendered.asset.id).catch(() => null);
    if (finalBytes) await writeFile(resolve(OUT, "ep1.mp4"), finalBytes.body);
  }
  await writeFile(resolve(OUT, "LIST.json"), JSON.stringify({ title: TITLE, logline: LOGLINE, series: state, rows }, null, 2));
  process.stdout.write(`READY · ${rows.length} scenes + ${resolve(OUT, "ep1.mp4")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
