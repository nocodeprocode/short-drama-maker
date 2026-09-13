/**
 * Re-measure every take of an episode on the bytes already in storage.
 *
 * No video generation: this re-runs STT and the identity judge, so a take
 * measured before a QC or caption fix picks up the new measurements (word
 * timings in particular, which is what captions are placed on).
 *
 *   npx tsx scripts/rejudge-episode.ts --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createAiGateway } = await import("../src/engine/ai/index.ts");
const { transcribeAudio } = await import("../src/engine/ai/stt.ts");
const { createEngine } = await import("../src/engine/create-engine.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { commitSeriesStore, hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { isSceneTake } = await import("../src/drama-engine/types/editorial.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const state = JSON.parse(await readFile(STATE, "utf8")) as {
  series_id: string;
  episode_id: string;
  owner_id: string;
};

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const engine = createEngine({
  ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
  store: loaded.store,
  assets,
});

const shots = engine.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position))
  .filter((shot) => isSceneTake(shot.shot_data));

for (const [index, shot] of shots.entries()) {
  const out = await engine.rejudgeShot({ owner_id: state.owner_id, shot_id: shot.id });
  const words = out.shot.shot_data.take_analysis?.transcript_words?.length ?? 0;
  process.stdout.write(
    `take ${index + 1}: ${out.chosen ? "complete" : "needs_review"} · ${words} word timings\n`,
  );
}

await commitSeriesStore(client, engine.store, state.series_id, assets.snapshot?.() ?? loaded.assets);
process.stdout.write("committed\n");
