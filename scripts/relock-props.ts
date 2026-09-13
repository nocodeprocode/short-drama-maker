/**
 * Re-derive every scene take's prop lock from the words actually spoken.
 *
 * Use after a prop-identity fix: the stored lock is whatever the planner wrote
 * at plan time, so a corrected `inferPropIdentity` does not reach shots that
 * are already in the store.
 *
 *   npx tsx scripts/relock-props.ts --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createAiGateway } = await import("../src/engine/ai/index.ts");
const { createEngine } = await import("../src/engine/create-engine.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { commitSeriesStore, hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { inferPropLock } = await import("../src/drama-engine/types/physics.ts");
const { isSceneTake } = await import("../src/drama-engine/types/editorial.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const engine = createEngine({ ai: createAiGateway({}), store: loaded.store, assets });

const shots = engine.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => engine.store.shotsFor(scene.id).sort((a, b) => a.position - b.position))
  .filter((shot) => isSceneTake(shot.shot_data));

// One episode, one hero object: derive from every take's words, not per take,
// so the lock cannot drift between shots.
const spoken = shots.map((shot) => shot.shot_data.scene_script ?? "").join("\n");
const lock = inferPropLock(spoken);
process.stdout.write(`episode prop lock: ${lock}\n`);

for (const [index, shot] of shots.entries()) {
  const before = shot.shot_data.blocking?.prop ?? "NONE";
  if (before === lock) continue;
  engine.store.shots.set(shot.id, {
    ...shot,
    shot_data: {
      ...shot.shot_data,
      blocking: { ...(shot.shot_data.blocking ?? {}), prop: lock },
    },
  });
  process.stdout.write(`take ${index + 1}: ${before}\n      -> ${lock}\n`);
}

await commitSeriesStore(client, engine.store, state.series_id, assets.snapshot?.() ?? loaded.assets);
process.stdout.write("committed\n");
