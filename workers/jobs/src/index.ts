import { runOnce } from "../../../src/engine/jobs/runner.ts";
import { setAssetFetch } from "../../../src/engine/storage/fetch.ts";
import { mediaRunnerConfigured, pokeMediaRunner, wakeMediaRunner } from "./wake.ts";

type MediaStoreFetcher = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };

type JobsEnv = Record<string, string | undefined> & {
  MEDIA_STORE?: MediaStoreFetcher;
  MEDIA_RUNNER?: MediaStoreFetcher;
  MEDIA_WORKER_TOKEN?: string;
  MEDIA_WORKER_URL?: string;
};

type ExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

function applyEnv(env: JobsEnv) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
  const media = env.MEDIA_STORE;
  if (media && typeof media.fetch === "function") {
    setAssetFetch((input, init) => {
      const url = typeof input === "string" || input instanceof URL ? new URL(String(input)) : new URL(input.url);
      return media.fetch(`https://media-store.internal${url.pathname}${url.search}`, init);
    });
  } else {
    setAssetFetch(null);
  }
}

async function tick() {
  return runOnce(undefined, 1);
}

export default {
  async fetch(request: Request, env: JobsEnv, ctx: ExecutionContext) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return Response.json({
        ok: true,
        role: "jobs",
        runner_role: env.RUNNER_ROLE ?? "all",
        media_runner: mediaRunnerConfigured(env),
      });
    }
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.JOBS_WAKE_SECRET || request.headers.get("x-jobs-secret") !== env.JOBS_WAKE_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
    applyEnv(env);
    // A wake says "there is work", and that is all it does. Draining the queue
    // takes minutes per actor pack, and a fetch invocation is not guaranteed to
    // live that long: claiming here meant a task could be leased and then torn
    // down having written neither an image nor an error, leaving the row parked
    // until its lease aged out. The cron tick owns execution; the wake only
    // nudges the media runner.
    ctx.waitUntil(pokeMediaRunner(env));
    return Response.json({ ok: true, woken: true, media_runner: mediaRunnerConfigured(env) });
  },

  async scheduled(_event: unknown, env: JobsEnv, ctx: ExecutionContext) {
    applyEnv(env);
    await tick();
    wakeMediaRunner(env, (promise) => ctx.waitUntil(promise));
  },
};
