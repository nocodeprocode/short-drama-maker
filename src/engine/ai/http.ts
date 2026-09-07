/**
 * One HTTP path for every provider call. Bare `fetch` had no timeout, so a
 * stalled upload or a hung poll could pin a runner forever; it also retried
 * nothing, so a single 429 or 502 failed a paid job. This wrapper adds a hard
 * per-request timeout, bounded retries on transient statuses that honour
 * `Retry-After`, and a per-host circuit breaker so a provider that is down
 * fails fast instead of burning the lease on every task.
 */
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`${provider} ${path} failed HTTP ${status}: ${body.slice(0, 800)}`);
    this.name = "ProviderHttpError";
  }

  get transient(): boolean {
    return isTransientStatus(this.status);
  }
}

export class ProviderTimeoutError extends Error {
  constructor(readonly provider: string, readonly path: string, readonly timeoutMs: number) {
    super(`${provider} ${path} timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export class ProviderCircuitOpenError extends Error {
  constructor(readonly provider: string, readonly untilMs: number) {
    super(`${provider} circuit open for ${Math.max(0, Math.round((untilMs - Date.now()) / 1000))}s after repeated failures`);
    this.name = "ProviderCircuitOpenError";
  }
}

export type ProviderFetchOptions = {
  provider: string;
  /** Path or label used in errors and breaker keys; defaults to the URL path. */
  label?: string;
  timeoutMs?: number;
  /** Retries on top of the first attempt. */
  retries?: number;
  /** Base for exponential backoff when the provider sends no Retry-After. */
  backoffMs?: number;
  /** Retry POSTs only when the caller says the request is idempotent. */
  idempotent?: boolean;
  signal?: AbortSignal;
};

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRIES = 3;
export const DEFAULT_BACKOFF_MS = 800;
export const MAX_RETRY_AFTER_MS = 30_000;

/** Consecutive failures before the breaker opens, and how long it stays open. */
export const BREAKER_THRESHOLD = 5;
export const BREAKER_OPEN_MS = 60_000;

export function isTransientStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  // 52x is the edge saying it could not reach or hold the model upstream.
  return status >= 520 && status <= 599;
}

export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - Date.now()));
  return null;
}

export function backoffDelayMs(attempt: number, base = DEFAULT_BACKOFF_MS): number {
  const exp = base * 2 ** attempt;
  // Full jitter keeps a fleet of runners from retrying in lockstep.
  return Math.round(Math.random() * Math.min(MAX_RETRY_AFTER_MS, exp));
}

type BreakerState = { failures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

function breakerFor(key: string): BreakerState {
  let state = breakers.get(key);
  if (!state) {
    state = { failures: 0, openUntil: 0 };
    breakers.set(key, state);
  }
  return state;
}

export function breakerStatus(provider: string): { failures: number; open: boolean; openUntil: number } {
  const state = breakerFor(provider);
  return { failures: state.failures, open: state.openUntil > Date.now(), openUntil: state.openUntil };
}

/** Tests and admin tooling. */
export function resetBreakers(): void {
  breakers.clear();
}

function recordFailure(provider: string, now: () => number) {
  const state = breakerFor(provider);
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD) state.openUntil = now() + BREAKER_OPEN_MS;
}

function recordSuccess(provider: string) {
  const state = breakerFor(provider);
  state.failures = 0;
  state.openUntil = 0;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ProviderFetchDeps = {
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with timeout, retries and a breaker. Resolves with the Response for
 * any 2xx; throws `ProviderHttpError` for the final non-2xx, `ProviderTimeoutError`
 * when the deadline passes, and `ProviderCircuitOpenError` without calling the
 * network while the breaker is open.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
  deps: ProviderFetchDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const label = options.label ?? safePath(url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = (init.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD" || options.idempotent === true;
  const retries = retryable ? options.retries ?? DEFAULT_RETRIES : 0;

  const breaker = breakerFor(options.provider);
  if (breaker.openUntil > now()) throw new ProviderCircuitOpenError(options.provider, breaker.openUntil);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted");
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new ProviderTimeoutError(options.provider, label, timeoutMs)), timeoutMs);
    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      if (response.ok) {
        recordSuccess(options.provider);
        return response;
      }
      const body = await response.text().catch(() => "");
      const error = new ProviderHttpError(options.provider, label, response.status, body, retryAfterMs(response.headers.get("retry-after")));
      if (!error.transient) {
        // 4xx other than rate limits is the caller's problem, not the provider's health.
        if (response.status >= 500) recordFailure(options.provider, now);
        throw error;
      }
      recordFailure(options.provider, now);
      lastError = error;
      if (attempt < retries) await sleep(error.retryAfterMs ?? backoffDelayMs(attempt, options.backoffMs));
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        if (!error.transient || attempt >= retries) throw error;
        continue;
      }
      const timedOut = controller.signal.aborted && controller.signal.reason instanceof ProviderTimeoutError;
      const wrapped = timedOut ? (controller.signal.reason as ProviderTimeoutError) : error;
      if (options.signal?.aborted && !timedOut) throw wrapped;
      recordFailure(options.provider, now);
      lastError = wrapped;
      if (attempt < retries) await sleep(backoffDelayMs(attempt, options.backoffMs));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${options.provider} ${label} failed`);
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
