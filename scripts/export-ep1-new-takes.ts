/**
 * Write the newest existing Seedance takes to new filenames. No generation.
 *
 *   npx tsx scripts/export-ep1-new-takes.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { commitSeriesStore, hydrateAssetStore, loadSeriesStore } from "../src/engine/store-postgres.ts";
import { loadLocalEnv } from "./load-env.ts";

const SERIES_ID = "92d0a750-01a7-4800-97fe-10a16cafde72";

/** Latest identity-locked take per scene. Scene 1 stays the take the user liked. */
const FORCE_TAKES = [
  { shotId: "f2a8f4c6-c1d6-4067-b365-7a471e0ea9fc", assetId: "e27a5732-d9ea-467f-baa5-619fee4fc344", file: "take-1-hook.mp4" },
  { shotId: "718fc948-5fd3-4d45-ade5-45bb6e55a4d4", assetId: "ad6d99e4-a7f5-4944-9f1a-faf4bfcbe89a", file: "take-2-drawer.mp4" },
  { shotId: "9816d771-fdc4-41c7-a972-1747dded17d0", assetId: "2370e6be-9e17-474c-95c6-73806fa65b38", file: "take-3-letter.mp4" },
  { shotId: "6f3f1764-6111-420c-b1ce-b03485d429f9", assetId: "02769c31-5e2d-4b77-bf79-7c5c05046195", file: "take-4-signed.mp4" },
  { shotId: "914291ca-6e15-4872-932f-889c9d9cc60b", assetId: "bb810910-9bd5-414f-b604-6c34665dfc3d", file: "take-5-button.mp4" },
] as const;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: series } = await client.from("series").select("owner_id").eq("id", SERIES_ID).single();
  if (!series) throw new Error("Series not found");

  const loaded = await loadSeriesStore(client, SERIES_ID);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, loaded.assets);

  const dir = resolve(process.cwd(), "assets", "live", "ep1-scene-takes-60s");
  await mkdir(dir, { recursive: true });
  const reviewedAt = new Date().toISOString();

  for (const take of FORCE_TAKES) {
    const stored = await assets.get(take.assetId);
    if (!stored) throw new Error(`Missing take ${take.assetId} (${take.file})`);
    const path = resolve(dir, take.file);
    await writeFile(path, stored.body);
    process.stdout.write(`wrote ${take.file} ${stored.body.byteLength} bytes ${take.assetId}\n`);

    const shot = loaded.store.shots.get(take.shotId);
    if (!shot) continue;
    loaded.store.shots.set(shot.id, {
      ...shot,
      selected_generation_id: take.assetId,
      shot_data: {
        ...shot.shot_data,
        heard_audio: "native",
        take_reviews: [
          {
            asset_id: take.assetId,
            decision: "approve",
            note: "pin newest existing scene take; do not recut the old approved file",
            reviewed_at: reviewedAt,
            reviewer_id: series.owner_id,
          },
        ],
      },
    });
  }

  await commitSeriesStore(client, loaded.store, SERIES_ID, assets.snapshot?.() ?? loaded.assets);

  const concatPath = resolve(dir, "final-v2-9x16.mp4");
  const inputs = FORCE_TAKES.flatMap((take) => ["-i", resolve(dir, take.file)]);
  await run("ffmpeg", [
    "-y",
    ...inputs,
    "-filter_complex",
    "[0:v][0:a][1:v][1:a][2:v][2:a][3:v][3:a][4:v][4:a]concat=n=5:v=1:a=1[v][a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    concatPath,
  ]);
  process.stdout.write(`READY · ${concatPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exit(1);
});
