type AssetFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let assetFetch: AssetFetch = globalThis.fetch.bind(globalThis);

export function setAssetFetch(fn: AssetFetch | null) {
  assetFetch = fn ?? globalThis.fetch.bind(globalThis);
}

/**
 * A stalled object-store connection must fail, not hang the ingest forever.
 * GET and PUT are idempotent for us, so a timeout or network drop is retried
 * a few times with backoff before the caller sees the error.
 */
export const MEDIA_FETCH_TIMEOUT_MS = 120_000;
export const MEDIA_FETCH_RETRIES = 2;

export class MediaFetchTimeoutError extends Error {
  constructor(readonly url: string, readonly timeoutMs: number) {
    super(`media store ${url.split("?")[0]} timed out after ${timeoutMs}ms`);
    this.name = "MediaFetchTimeoutError";
  }
}

/** Statuses that mean "later", not "never": rate limits and server faults. */
const RETRYABLE_STATUS = (status: number): boolean => status === 408 || status === 429 || status >= 500;

/**
 * R2 reports its own internal faults as a 400 with an error code in the body,
 * so status alone cannot tell that apart from a request we got wrong.
 */
export function isTransientStoreFailure(status: number, body: string): boolean {
  if (RETRYABLE_STATUS(status)) return true;
  return status === 400 && /internal error|\(10001\)/i.test(body);
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function mediaFetch(
  input: string | URL | Request,
  init?: RequestInit,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? MEDIA_FETCH_TIMEOUT_MS;
  const retries = options.retries ?? MEDIA_FETCH_RETRIES;
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "PUT" || method === "HEAD";
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new MediaFetchTimeoutError(urlOf(input), timeoutMs)), timeoutMs);
    try {
      const response = await assetFetch(input, { ...init, signal: controller.signal });
      // The store answers a busy moment with a status, not a dropped socket.
      if (!retryable || attempt === retries || !RETRYABLE_STATUS(response.status)) return response;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    } catch (error) {
      lastError = controller.signal.aborted ? controller.signal.reason ?? error : error;
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
