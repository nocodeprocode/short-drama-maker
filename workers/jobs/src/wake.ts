/**
 * The Cloudflare jobs Worker has no ffmpeg. After it claims orchestration
 * work it wakes the media container, which runs the same createEngine as
 * local `RUNNER_ROLE=media npm run jobs` for generate_video / ingest / cut.
 */
export type MediaWakeEnv = {
  MEDIA_WORKER_TOKEN?: string;
  MEDIA_WORKER_URL?: string;
  MEDIA_RUNNER?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
};

export function mediaWakeRequest(env: MediaWakeEnv): { input: string; init: RequestInit } | null {
  const token = env.MEDIA_WORKER_TOKEN?.trim();
  if (!token) return null;
  const url = env.MEDIA_WORKER_URL?.trim().replace(/\/$/, "");
  if (!env.MEDIA_RUNNER && !url) return null;
  return {
    input: env.MEDIA_RUNNER ? "https://media-runner.internal/jobs" : `${url}/jobs`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  };
}

export function mediaRunnerConfigured(env: MediaWakeEnv): boolean {
  return Boolean(env.MEDIA_WORKER_TOKEN?.trim() && (env.MEDIA_RUNNER || env.MEDIA_WORKER_URL?.trim()));
}

/** Pokes the media container and resolves whether or not it answers. */
export function pokeMediaRunner(env: MediaWakeEnv): Promise<void> {
  const request = mediaWakeRequest(env);
  if (!request) return Promise.resolve();
  const pending = env.MEDIA_RUNNER
    ? env.MEDIA_RUNNER.fetch(request.input, request.init)
    : fetch(request.input, request.init);
  return pending.then(
    () => undefined,
    () => undefined,
  );
}

export function wakeMediaRunner(env: MediaWakeEnv, waitUntil: (promise: Promise<unknown>) => void): boolean {
  if (!mediaWakeRequest(env)) return false;
  waitUntil(pokeMediaRunner(env));
  return true;
}
