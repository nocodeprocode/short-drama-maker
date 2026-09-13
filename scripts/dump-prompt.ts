/**
 * Print the exact video prompt sent for a take, with its size.
 *
 *   npx tsx scripts/dump-prompt.ts 1 --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { loadSeriesStore } = await import("../src/engine/store-postgres.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const want = Number(args.find((row) => /^\d+$/.test(row)) ?? "1");
const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const shots = loaded.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => loaded.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));

const shot = shots[want - 1];
if (!shot) throw new Error(`No take ${want}`);

const jobs = [...loaded.store.jobs.values()]
  .filter((job) => job.shot_id === shot.id && job.job_type === "video")
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const job = jobs.at(-1);
const prompt = typeof job?.request_metadata?.prompt === "string" ? job.request_metadata.prompt : null;
if (!prompt) {
  process.stdout.write(`no stored prompt; job keys: ${Object.keys(job?.request_metadata ?? {}).join(", ")}\n`);
} else {
  process.stdout.write(`chars=${prompt.length} words=${prompt.split(/\s+/).length}\n`);
  const braces = prompt.match(/\{[^}]*\}/g) ?? [];
  process.stdout.write(`braces=${braces.length}\n${braces.join("\n")}\n`);
  const at = prompt.indexOf("SHOT LIST");
  process.stdout.write(`\nSHOT LIST begins at char ${at} of ${prompt.length}\n`);
  process.stdout.write(`\n---- FULL PROMPT ----\n${prompt}\n`);
}
