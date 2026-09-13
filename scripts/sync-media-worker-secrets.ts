/**
 * Copy engine secrets onto the media container Worker and point the
 * orchestrator at it. Never prints secret values.
 *
 *   npx tsx scripts/sync-media-worker-secrets.ts
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const MEDIA_CONFIG = "worker/wrangler.jsonc";
const JOBS_CONFIG = "workers/jobs/wrangler.jsonc";
const MEDIA_URL = "https://short-drama-media-worker.despianative.workers.dev";

const FROM_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_WEBHOOK_SECRET",
  "ELEVENLABS_API_KEY",
  "MEDIA_STORE_URL",
  "MEDIA_SIGNING_SECRET",
  "MEDIA_STORE_TOKEN",
] as const;

function put(config: string, key: string, value: string) {
  if (!value.trim()) throw new Error(`${key} is empty`);
  const result = spawnSync("npx", ["wrangler", "secret", "put", key, "--config", config], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "secret put failed").trim();
    throw new Error(`${key} on ${config}: ${err.split("\n").at(-1)}`);
  }
  process.stdout.write(`set ${key} on ${config}\n`);
}

const token = process.env.MEDIA_WORKER_TOKEN?.trim() || randomBytes(32).toString("hex");
for (const key of FROM_ENV) {
  put(MEDIA_CONFIG, key, process.env[key] ?? "");
}
put(MEDIA_CONFIG, "MEDIA_WORKER_TOKEN", token);
put(JOBS_CONFIG, "MEDIA_WORKER_TOKEN", token);
put(JOBS_CONFIG, "MEDIA_WORKER_URL", MEDIA_URL);
process.stdout.write("media runner secrets wired\n");
