import { STANDARD_PRIVACY } from "../config/models.ts";
import { requireOpenRouterKey } from "./env.ts";

export const OPENROUTER_API = "https://openrouter.ai/api/v1";

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

export async function openRouterRaw(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(`${OPENROUTER_API}${path}`, {
    ...init,
    headers: openRouterHeaders(init.headers),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

export async function openRouterJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${OPENROUTER_API}${path}`, {
    ...init,
    headers: openRouterHeaders(init.headers),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${path} failed HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  if (!text) {
    throw new Error(`OpenRouter ${path} returned an empty body`);
  }
  return JSON.parse(text) as T;
}

export async function openRouterBytes(
  path: string,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; mime_type: string }> {
  const response = await fetch(`${OPENROUTER_API}${path}`, {
    ...init,
    headers: openRouterHeaders(init.headers),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${path} failed HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime_type: response.headers.get("content-type") ?? "application/octet-stream",
  };
}
