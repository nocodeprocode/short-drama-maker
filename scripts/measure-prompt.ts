/**
 * Build the video prompt for each take of an episode and report its size and
 * where the dialogue sits. The words are what a video model drops first when
 * the instruction budget is spent, so both numbers are load-bearing.
 *
 *   npx tsx scripts/measure-prompt.ts --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { dramaHooks } = await import("../src/drama-engine/index.ts");
const { isSceneTake } = await import("../src/drama-engine/types/editorial.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const shots = loaded.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => loaded.store.shotsFor(scene.id).sort((a, b) => a.position - b.position))
  .filter((shot) => isSceneTake(shot.shot_data));

for (const [index, shot] of shots.entries()) {
  const prompt = dramaHooks.buildVideoPrompt({
    location: loaded.store.scenes.get(shot.scene_id)?.location ?? null,
    shot,
    takeIndex: index,
  });
  const at = prompt.indexOf("SHOT LIST");
  const braces = (prompt.match(/\{[^}]*\}/g) ?? []).filter((row) => !/^\{braces?\}$/.test(row));
  process.stdout.write(
    `take ${index + 1}: ${prompt.length} chars · SHOT LIST at ${at} (${Math.round((at / prompt.length) * 100)}%) · ${braces.length} spoken lines\n`,
  );
}
