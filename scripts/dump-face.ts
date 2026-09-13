/**
 * Dump a character's locked stills to disk so a human (or the agent) can see
 * the face the video model is actually being handed.
 *
 *   npx tsx scripts/dump-face.ts ROMAN --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const target = args.find((row, index) => !row.startsWith("--") && args[index - 1] !== "--state");
if (!target) throw new Error("Usage: dump-face.ts NAME --state path");

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);

const character = loaded.store
  .charactersFor(state.series_id)
  .find((row) => row.name.toLowerCase().startsWith(target.toLowerCase()));
if (!character) throw new Error(`No character matching ${target}`);

process.stdout.write(`${character.name}\n  face: ${character.appearance_profile?.face ?? "—"}\n`);
const out = resolve(dirname(STATE), "stills");
await mkdir(out, { recursive: true });
const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
for (const [kind, id] of Object.entries(character.visual_reference_asset_ids ?? {})) {
  if (typeof id !== "string") continue;
  const got = await assets.get(id);
  if (!got) continue;
  const path = resolve(out, `${slug}-${kind}.jpg`);
  await writeFile(path, got.body);
  process.stdout.write(`  wrote ${path}\n`);
}
