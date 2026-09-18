import { Container, getContainer } from "@cloudflare/containers";

export class MediaWorker extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";
  enableInternet = true;
  pingEndpoint = "/health";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      RUNNER_ROLE: "media",
      MEDIA_WORKER_TOKEN: env.MEDIA_WORKER_TOKEN ?? "",
      SUPABASE_URL: env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "",
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ?? "",
      OPENROUTER_WEBHOOK_SECRET: env.OPENROUTER_WEBHOOK_SECRET ?? "",
      ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY ?? "",
      MEDIA_STORE_URL: env.MEDIA_STORE_URL ?? "",
      MEDIA_SIGNING_SECRET: env.MEDIA_SIGNING_SECRET ?? "",
      MEDIA_STORE_TOKEN: env.MEDIA_STORE_TOKEN ?? "",
    };
  }
}

type Env = {
  MEDIA_WORKER: DurableObjectNamespace;
  /** Shared bearer secret; also injected into the container as MEDIA_WORKER_TOKEN. */
  MEDIA_WORKER_TOKEN?: string;
  /** How many container instances to spread renders across (default 2, matches wrangler max_instances). */
  MEDIA_WORKER_SHARDS?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_WEBHOOK_SECRET?: string;
  ELEVENLABS_API_KEY?: string;
  MEDIA_STORE_URL?: string;
  MEDIA_SIGNING_SECRET?: string;
  MEDIA_STORE_TOKEN?: string;
};

/**
 * Renders are CPU-bound and take minutes; a single hot instance serialises the
 * whole platform. Shard by a caller-supplied key (episode id) so one episode
 * always lands on the same instance while different episodes run in parallel.
 */
function shardName(request: Request, env: Env): string {
  const shards = Math.max(1, Number(env.MEDIA_WORKER_SHARDS ?? 2) || 2);
  const key = request.headers.get("x-render-key") ?? new URL(request.url).searchParams.get("key") ?? "";
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `runtime-v2-shard-${key ? hash % shards : Math.floor(Math.random() * shards)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/health") {
      const auth = request.headers.get("authorization") ?? "";
      if (!env.MEDIA_WORKER_TOKEN || auth !== `Bearer ${env.MEDIA_WORKER_TOKEN}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }
    const container = getContainer(env.MEDIA_WORKER, shardName(request, env));
    await container.startAndWaitForPorts({
      cancellationOptions: { portReadyTimeoutMS: 60_000 },
    });
    return container.fetch(request);
  },
};
