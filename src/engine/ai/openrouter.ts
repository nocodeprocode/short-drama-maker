import { STANDARD_PRIVACY } from "../config/models.ts";
import { requireOpenRouterKey } from "./env.ts";
import { providerFetch, type ProviderFetchOptions } from "./http.ts";

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

/** Chat/JSON completions can run long on big plans; video submits are quick, downloads are large. */
export const OPENROUTER_TIMEOUTS_MS = {
  json: 120_000,
  submit: 60_000,
  poll: 30_000,
  download: 180_000,
} as const;

export function openRouterProvider(kind: "text" | "image" | "video" = "text") {
  if (kind === "video") {
    return {
      data_collection: STANDARD_PRIVACY.data_collection,
      allow_fallbacks: STANDARD_PRIVACY.allow_fallbacks,
    };
  }
  return {
    zdr: STANDARD_PRIVACY.zdr,
    data_collection: STANDARD_PRIVACY.data_collection,
    allow_fallbacks: STANDARD_PRIVACY.allow_fallbacks,
  };
}

export function openRouterHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${requireOpenRouterKey()}`);
  headers.set("Content-Type", "application/json");
  headers.set("HTTP-Referer", "https://shortdramamaker.app");
  headers.set("X-Title", "Short Drama Maker");
  return headers;
}

type CallOptions = Partial<Omit<ProviderFetchOptions, "provider">>;

function call(path: string, init: RequestInit, options: CallOptions): Promise<Response> {
  return providerFetch(
    `${OPENROUTER_API}${path}`,
    { ...init, headers: openRouterHeaders(init.headers) },
    { provider: "openrouter", label: path, timeoutMs: OPENROUTER_TIMEOUTS_MS.json, ...options },
  );
}

/** Raw status + text; never throws on non-2xx (callers that need the body on failure). */
export async function openRouterRaw(
  path: string,
  init: RequestInit = {},
  options: CallOptions = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const response = await call(path, init, options);
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && "body" in error) {
      const failed = error as { status: number; body: string };
      return { ok: false, status: failed.status, text: failed.body };
    }
    throw error;
  }
}

export async function openRouterJson<T>(path: string, init: RequestInit = {}, options: CallOptions = {}): Promise<T> {
  const response = await call(path, init, options);
  const text = await response.text();
  if (!text) {
    throw new Error(`OpenRouter ${path} returned an empty body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`OpenRouter ${path} returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export async function openRouterBytes(
  path: string,
  init: RequestInit = {},
  options: CallOptions = {},
): Promise<{ bytes: Uint8Array; mime_type: string }> {
  const response = await call(path, init, { timeoutMs: OPENROUTER_TIMEOUTS_MS.download, ...options });
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime_type: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
