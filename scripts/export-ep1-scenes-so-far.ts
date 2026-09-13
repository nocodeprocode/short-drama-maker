import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";
const EPISODE_ID = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";
const OUT = resolve(process.cwd(), "assets", "live", "ep1-scenes");

function probe(file: string): Promise<number> {
  return new Promise((resolveProbe) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("exit", () => resolveProbe(Number(out.trim()) || 0));
    child.on("error", () => resolveProbe(0));
  });
}

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const loaded = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, loaded.assets);
  await mkdir(OUT, { recursive: true });
  const shots = loaded.store
    .scenesFor(EPISODE_ID)
    .sort((a, b) => a.position - b.position)
    .flatMap((scene) => loaded.store.shotsFor(scene.id).sort((a, b) => a.position - b.position));
  let wrote = 0;
  for (const [index, shot] of shots.entries()) {
    const takeId = shot.selected_generation_id;
    if (!takeId) continue;
    const take = await assets.get(takeId).catch(() => null);
    if (!take) continue;
    const name = `scene-${String(index + 1).padStart(2, "0")}.mp4`;
    const dest = resolve(OUT, name);
    await writeFile(dest, take.body);
    const seconds = await probe(dest);
    wrote += 1;
    process.stdout.write(`${name} ${seconds.toFixed(2)}s hinted ${shot.shot_data.duration_hint_seconds}s ${shot.shot_data.dialogue ?? ""}\n`);
  }
  if (!wrote) process.stdout.write("no completed takes exported\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
