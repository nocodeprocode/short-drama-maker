/**
 * Recut episode 1 from existing Seedance takes, using native speech.
 *
 *   npx tsx scripts/recut-ep1-scene-takes.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { transcribeAudio } from "../src/engine/ai/stt.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { isSceneTake } from "../src/drama-engine/types/editorial.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import type { Asset } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: series } = await client.from("series").select("owner_id").eq("id", SERIES_ID).single();
  if (!series) throw new Error("Series not found");

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "cancelled for local ep1 recut" })
    .eq("series_id", SERIES_ID)
    .in("status", ["queued", "running"]);

  const loaded = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, loaded.assets);
  const engine = createEngine({
    store: loaded.store,
    assets,
    skipSeriesBudget: true,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    render: renderEpisodeBytes,
  });
  engine.store.queue = [];

  for (const shot of engine.store.shotsForEpisode(EPISODE_ID)) {
    if (!isSceneTake(shot.shot_data)) continue;
    engine.store.shots.set(shot.id, {
      ...shot,
      shot_data: { ...shot.shot_data, heard_audio: "native" },
    });
  }

  process.stdout.write("recutting episode 1 as locked Seedance mux (no dialogue slip)…\n");
  const rendered = await engine.renderEpisode({ owner_id: series.owner_id, episode_id: EPISODE_ID });
  await commitSeriesStore(client, engine.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);
  process.stdout.write(`render ${rendered.episode.status} checksum ${rendered.checksum ?? ""}\n`);

  const { data: assetRows } = await client
    .from("assets")
    .select("*")
    .eq("series_id", SERIES_ID)
    .in("kind", ["episode_final", "episode_captions", "episode_provenance", "episode_audit"])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(8);
  const dir = resolve(process.cwd(), "assets", "live", "ep1-scene-takes-60s");
  await mkdir(dir, { recursive: true });
  hydrateAssetStore(assets, (assetRows ?? []) as Asset[]);
  const saved: string[] = [];
  for (const row of (assetRows ?? []) as Asset[]) {
    const stored = await assets.get(row.id).catch(() => null);
    if (!stored) continue;
    const name =
      row.kind === "episode_final"
        ? "final-v2-9x16.mp4"
        : row.kind === "episode_captions"
          ? "captions-v2.srt"
          : row.kind === "episode_provenance"
            ? "provenance-v2.json"
            : `audit-${row.id.slice(0, 8)}.json`;
    await writeFile(resolve(dir, name), stored.body);
    saved.push(name);
    if (row.kind === "episode_final") break;
  }
  process.stdout.write(`READY · saved ${saved.join(", ")} to ${dir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
