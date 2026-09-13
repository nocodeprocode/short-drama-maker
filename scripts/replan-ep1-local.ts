/**
 * Replan episode 1 through the local engine (bypasses any remote runner on old code).
 *
 *   npx tsx scripts/replan-ep1-local.ts
 */
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { configuredRender } from "../src/engine/media/remote-render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import { validateEpisodePlan } from "../src/drama-engine/lint/validate-plan.ts";
import { loadLocalEnv } from "./load-env.ts";

const PRODUCTION_ID = "9af2694d-5564-4502-be19-d0a3aa1aa2d3";
const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for local replan" })
    .eq("production_id", PRODUCTION_ID)
    .in("status", ["queued", "running"]);

  const { data: scenes } = await client.from("scenes").select("id").eq("episode_id", EPISODE_ID);
  if (scenes?.length) {
    const { error } = await client.from("scenes").delete().in(
      "id",
      scenes.map((row) => row.id),
    );
    if (error) throw new Error(error.message);
  }
  await client
    .from("episodes")
    .update({ status: "draft", script: "", episode_outline: null, render_manifest: null, updated_at: new Date().toISOString() })
    .eq("id", EPISODE_ID);

  const { store, assets: assetRows } = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, assetRows);
  const engine = createEngine({
    store,
    assets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    render: configuredRender(),
  });

  const { data: production } = await client.from("productions").select("owner_id, episode_length").eq("id", PRODUCTION_ID).single();
  if (!production) throw new Error("Production not found");

  process.stdout.write("planning episode 1 via local engine…\n");
  const result = await engine.planEpisode({
    owner_id: production.owner_id,
    episode_id: EPISODE_ID,
    episode_length: production.episode_length ?? "60_90",
  });

  const snapshot = "snapshot" in assets && typeof assets.snapshot === "function" ? assets.snapshot() : assetRows;
  await commitSeriesStore(client, engine.store, SERIES_ID, snapshot);

  const namedCast = engine.store.charactersFor(SERIES_ID).map((character) => character.name);
  const plan = {
    title: result.episode.title,
    hook: "",
    conflict: "",
    cliffhanger: result.episode.script,
    scenes: result.scenes.map((scene) => ({
      location: scene.location,
      time: scene.scene_data.time ?? "night",
      characters: scene.scene_data.characters ?? [],
      shots: engine.store.shotsFor(scene.id).map((shot) => shot.shot_data),
    })),
  };
  const lint = validateEpisodePlan({ plan, namedCast, length: "60_90", episodeNumber: 1 });
  const shotCount = result.shots.length;
  const beats = new Set(result.scenes.map((scene) => scene.scene_data.block_index).filter((v) => v != null));

  process.stdout.write(
    JSON.stringify(
      {
        shotCount,
        sceneCount: result.scenes.length,
        beats: beats.size,
        lintPass: lint.pass,
        blocking: lint.blocking.map((row) => row.id),
        first: {
          fn: result.shots[0]?.shot_data.function,
          dlg: result.shots[0]?.shot_data.dialogue?.slice(0, 40),
          dur: result.shots[0]?.shot_data.duration_hint_seconds,
        },
      },
      null,
      2,
    ) + "\n",
  );

  if (!lint.pass || shotCount < 20 || shotCount > 28) {
    throw new Error(`Replan failed handbook QA: ${shotCount} shots, lint ${lint.pass ? "pass" : lint.blocking.map((r) => r.id).join(",")}`);
  }

  await client.from("engine_tasks").insert({
    owner_id: production.owner_id,
    series_id: SERIES_ID,
    production_id: PRODUCTION_ID,
    action: "advance_production",
    payload: { production_id: PRODUCTION_ID },
    status: "queued",
  });
  await client
    .from("productions")
    .update({ status: "queued", paused: false, ui_phase: "preparing", intervention: {}, agent_decision: "Ep1 replanned locally.", updated_at: new Date().toISOString() })
    .eq("id", PRODUCTION_ID);

  process.stdout.write("replan ok · advance_production queued\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
