/**
 * Reviewer utility: load a series from the hosted database and cut an episode
 * locally through the exact product path (renderEpisode + mux audit), printing
 * the audit per line. Nothing is written back unless --commit is passed; the
 * final and audit are saved next to the other live outputs.
 *
 *   node --import tsx scripts/render-episode.ts --episode <episode_id> [--commit] [--out dir]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { RenderFailedError } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  loadLocalEnv();
  const episodeId = arg("--episode");
  if (!episodeId) throw new Error("--episode is required");
  const client = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: episodeRow, error } = await client.from("episodes").select("id, series_id, episode_number, title").eq("id", episodeId).single();
  if (error) throw new Error(error.message);
  const { store, assets: assetRows } = await loadSeriesStore(client, episodeRow.series_id);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets as never, assetRows);
  const series = store.series.get(episodeRow.series_id)!;
  const engine = createEngine({
    store,
    assets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
  });
  const out = resolve(process.cwd(), arg("--out") ?? `assets/live/render-${episodeId.slice(0, 8)}`);
  await mkdir(out, { recursive: true });

  let failure: string | null = null;
  let result: Awaited<ReturnType<typeof engine.renderEpisode>> | null = null;
  try {
    result = await engine.renderEpisode({ owner_id: series.owner_id, episode_id: episodeId, deliverables: ["1:1", "16:9"] });
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : String(caught);
    if (!(caught instanceof RenderFailedError)) throw caught;
  }

  // Latest audit written by the render, straight from the in-memory snapshot.
  const snapshot = (assets as unknown as { snapshot?: () => Array<{ id: string; kind: string; created_at: string }> }).snapshot?.() ?? [];
  const audits = snapshot.filter((row) => row.kind === "episode_audit").sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (audits[0]) {
    const stored = await assets.get(audits[0].id);
    if (stored) {
      const audit = JSON.parse(new TextDecoder().decode(stored.body)) as Record<string, unknown>;
      await writeFile(resolve(out, "audit.json"), JSON.stringify(audit, null, 2));
      process.stdout.write(`audit ship=${String(audit.ship)} reasons=${JSON.stringify(audit.reasons)} dur=${audit.duration_seconds}/${audit.expected_duration_seconds} lufs=${audit.integrated_lufs} tp=${audit.true_peak_dbfs}\n`);
      for (const line of (audit.lines as Array<Record<string, unknown>>) ?? []) {
        process.stdout.write(
          `  ${String(line.speaker ?? "").padEnd(8)} start=${line.picture_start_s} voice=${line.voice_onset_s} expected=${line.expected_voice_s} mouth=${line.mouth_open_s} lag=${line.lag_ms}ms/${line.limit_ms} head=${line.head_step} ${line.pass ? "PASS" : "FAIL"}\n`,
        );
      }
    }
  }
  const manifest = store.episodes.get(episodeId)?.render_manifest;
  if (manifest) {
    await writeFile(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
    for (const shot of manifest.shots) {
      process.stdout.write(
        `  clip ${shot.shot_id.slice(0, 8)} start=${shot.picture_start_seconds?.toFixed(2)} in=${shot.in_point_seconds} out=${shot.out_point_seconds.toFixed(2)} hold=${shot.hold_tail_seconds ?? 0} lane=${shot.heard_audio ?? "?"} role=${shot.audio_role} slip=${shot.audio_slip_seconds ?? 0}\n`,
      );
    }
  }
  if (result) {
    await writeFile(resolve(out, `final-v${result.version}-9x16.mp4`), result.asset ? (await assets.get(result.asset.id))!.body : new Uint8Array());
    for (const row of result.deliverables) {
      if (row.aspect === "9:16") continue;
      const stored = await assets.get(row.asset_id);
      if (stored) await writeFile(resolve(out, `final-v${result.version}-${row.aspect.replace(":", "x")}.mp4`), stored.body);
    }
    const captions = await assets.get(result.captions_asset_id);
    if (captions) await writeFile(resolve(out, `captions-v${result.version}.srt`), captions.body);
    const provenance = await assets.get(result.provenance_asset_id);
    if (provenance) await writeFile(resolve(out, `provenance-v${result.version}.json`), provenance.body);
    process.stdout.write(`RENDERED v${result.version} · ${result.checksum} · saved to ${out}\n`);
  } else {
    process.stdout.write(`REFUSED · ${failure}\n`);
  }
  if (process.argv.includes("--commit")) {
    await commitSeriesStore(client, store, series.id, snapshot as never);
    process.stdout.write("committed\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
