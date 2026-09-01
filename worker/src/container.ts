import { Container } from "@cloudflare/containers";

export class MediaWorker extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = { MEDIA_WORKER_TOKEN: env.MEDIA_WORKER_TOKEN ?? "" };
  }
}

type Env = {
  MEDIA_WORKER: DurableObjectNamespace;
  /** Shared bearer secret; also injected into the container as MEDIA_WORKER_TOKEN. */
  MEDIA_WORKER_TOKEN?: string;
  /** How many container instances to spread renders across (default 2, matches wrangler max_instances). */
  MEDIA_WORKER_SHARDS?: string;
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
  return `shard-${key ? hash % shards : Math.floor(Math.random() * shards)}`;
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
    const container = env.MEDIA_WORKER.getByName(shardName(request, env));
    return container.fetch(request);
  },
};
