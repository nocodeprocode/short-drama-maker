const REDACT = new Set([
  "script",
  "dialogue",
  "text",
  "idea",
  "prompt",
  "signed_url",
  "audio",
  "bytes",
  "api_key",
  "token",
]);

export function publicLog(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACT.has(key) || key.endsWith("_key") || key.endsWith("_token")) {
      continue;
    }
    out[key] = entry;
  }
  return out;
}
