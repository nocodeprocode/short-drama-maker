/**
 * Reviewer utility: download every take of a shot (or the finals of a series)
 * from the media store into a local folder, with a one-row-per-second frame
 * tile for each so a take can be judged at a glance.
 *
 *   node --import tsx scripts/fetch-takes.ts --shot <shot_id> [--out dir]
 *   node --import tsx scripts/fetch-takes.ts --series <series_id> [--out dir]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { hydrateAssetStore } from "../src/engine/store-postgres.ts";
import type { Asset } from "../src/engine/domain.ts";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function tile(input: string, output: string): Promise<void> {
  return new Promise((done) => {
    const child = spawn("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-vf", "fps=1,scale=180:-1,tile=8x1", output], { stdio: "ignore" });
    child.on("exit", () => done());
    child.on("error", () => done());
  });
}

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const shotId = arg("--shot");
  const seriesId = arg("--series");
  if (!shotId && !seriesId) throw new Error("--shot or --series is required");
  const out = resolve(process.cwd(), arg("--out") ?? `assets/review/${(shotId ?? seriesId)!.slice(0, 8)}`);
  await mkdir(out, { recursive: true });

  let rows: Asset[] = [];
  let labels = new Map<string, string>();
  if (shotId) {
    const { data: jobs } = await client.from("generation_jobs").select("id, result_metadata, model, status").eq("shot_id", shotId).eq("job_type", "video");
    const ids = (jobs ?? []).map((job) => (job.result_metadata as Record<string, unknown>).asset_id).filter((id): id is string => typeof id === "string");
    const { data } = await client.from("assets").select("*").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    rows = (data ?? []) as Asset[];
    for (const job of jobs ?? []) {
      const meta = job.result_metadata as Record<string, unknown>;
      if (typeof meta.asset_id === "string") {
        labels.set(meta.asset_id, `take-${String(job.id).slice(0, 8)}-${job.status}-${JSON.stringify(meta.take_blockers ?? "?").replace(/[^a-z_,]/g, "") || "clean"}`);
      }
    }
  } else {
    const { data } = await client.from("assets").select("*").eq("series_id", seriesId!).in("kind", ["episode_final", "episode_block"]).is("deleted_at", null);
    rows = (data ?? []) as Asset[];
    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>;
      labels.set(row.id, `${row.kind}-v${meta.version ?? "0"}-${String(meta.aspect ?? "9:16").replace(":", "x")}-${String(meta.block_index ?? "")}`);
    }
  }
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets as never, rows);
  for (const row of rows) {
    const got = await assets.get(row.id).catch(() => null);
    if (!got) continue;
    const name = labels.get(row.id) ?? row.id.slice(0, 8);
    const file = resolve(out, `${name}.mp4`);
    await writeFile(file, got.body);
    await tile(file, resolve(out, `${name}.png`));
    process.stdout.write(`${name}.mp4 ${got.body.byteLength} bytes\n`);
  }
  process.stdout.write(`saved to ${out}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
