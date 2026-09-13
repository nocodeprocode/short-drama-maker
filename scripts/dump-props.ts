/**
 * Print the locked prop and coverage per scene take.
 *
 *   npx tsx scripts/dump-props.ts --state assets/live/wolf-boss-hired-his-mate/series.json
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
const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const shots = loaded.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => loaded.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));

for (const [index, shot] of shots.entries()) {
  const blocking = shot.shot_data.blocking ?? {};
  process.stdout.write(
    `take ${index + 1} | coverage=${blocking.coverage ?? "—"} | prop=${blocking.prop ?? "NONE"}\n`,
  );
}

const { speechOffScriptReasons } = await import("../src/engine/pipeline/seedance-qc.ts");
const { wordErrorRate } = await import("../src/engine/media/qc.ts");
const { cueRows, cueText } = await import("../src/drama-engine/types/continuity.ts");

process.stdout.write("\nANALYSIS\n");
for (const [index, shot] of shots.entries()) {
  const a = shot.shot_data.take_analysis;
  const planned = cueRows(shot.shot_data.scene_script)
    .map((row) => cueText(row).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())
    .join(" ");
  const heard = (a?.transcript ?? "").trim();
  const wer = heard ? wordErrorRate(planned, heard) : null;
  process.stdout.write(
    `\ntake ${index + 1} | words=${a?.transcript_words?.length ?? 0} | stt_error=${a?.transcript_error ?? false} | WER=${wer?.toFixed(2) ?? "n/a"} | ${speechOffScriptReasons(heard, shot.shot_data.scene_script).join(",") || "on script"}\n` +
      `  planned: ${planned.slice(0, 120)}\n  heard  : ${heard.slice(0, 120)}\n`,
  );
}

const all = shots.map((shot) => shot.shot_data.scene_script ?? "").join("\n").toLowerCase();
process.stdout.write(`\nSCRIPTS\n${shots.map((s) => s.shot_data.scene_script).join("\n---\n")}\n`);
for (const [label, pattern] of [
  ["envelope", /\benvelopes?\b/g],
  ["contract/folder", /\b(contract|nda|folder)\b/g],
  ["parcel", /\b(parcel|package|delivery box)\b/g],
  ["letter/paper", /\b(letter|paper|note)\b/g],
] as const) {
  process.stdout.write(`${label}: ${(all.match(pattern) ?? []).length}\n`);
}
