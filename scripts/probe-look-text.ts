/**
 * Print the two places a character's look reaches a video prompt: the identity
 * lock and the CONTEXT cast line. Eye colour must appear in neither — the still
 * carries the eyes, and naming a colour makes the model paint it.
 *
 *   npx tsx scripts/probe-look-text.ts --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { identityLockLine } = await import("../src/drama-engine/craft/prompt-fragments.ts");
const { videoContextBlock } = await import("../src/drama-engine/craft/video-context.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(process.cwd(), stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "");
const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string };

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const series = loaded.store.series.get(state.series_id)!;
const characters = loaded.store.charactersFor(state.series_id);

process.stdout.write("IDENTITY LOCKS (from the live character records)\n");
for (const character of characters.slice(0, 3)) {
  process.stdout.write(`  ${identityLockLine(character.name, character.appearance_profile)}\n`);
}

const context = videoContextBlock({
  title: series.story_bible?.title ?? series.title,
  logline: series.story_bible?.logline ?? series.description,
  episodeNumber: 1,
  characters: series.story_bible?.characters,
  thisTake: { index: 0, present: characters.slice(0, 2).map((row) => row.name) },
});
process.stdout.write(`\nCONTEXT (from the stored bible)\n  ${context}\n`);

const all = `${characters.map((c) => identityLockLine(c.name, c.appearance_profile)).join(" ")} ${context ?? ""}`;
const hits = all.match(/[^.;|]{0,40}\b(?:eyes?|iris(?:es)?)\b[^.;|]{0,30}/gi) ?? [];
process.stdout.write(`\nEYE MENTIONS: ${hits.length}\n${hits.map((row) => `  ${row.trim()}`).join("\n")}\n`);
