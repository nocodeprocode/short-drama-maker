import { STT_PRICE_PER_MINUTE } from "../config/models.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
import { openRouterJson } from "./openrouter.ts";

/** MP3 at ~128 kbps; only used to meter cost when the provider reports none. */
const APPROX_MP3_BYTES_PER_SECOND = 16_000;

export async function transcribeAudio(input: {
  bytes: Uint8Array;
  format: string;
}): Promise<{ text: string }> {
  const data = Buffer.from(input.bytes).toString("base64");
  const body = await openRouterJson<{ text?: string; usage?: { cost?: number } }>("/audio/transcriptions", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.OPENROUTER_STT_MODEL?.trim() || "openai/whisper-large-v3",
      input_audio: { data, format: input.format },
      usage: { include: true },
    }),
  }, { idempotent: true });
  const minutes = input.bytes.byteLength / APPROX_MP3_BYTES_PER_SECOND / 60;
  costMeter.record({
    ...openRouterUsageCost(body.usage, STT_PRICE_PER_MINUTE * minutes, "stt"),
    usage: { audio_minutes: Number(minutes.toFixed(3)) },
  });
  if (!body.text?.trim()) {
    throw new Error("OpenRouter STT returned an empty transcript");
  }
  return { text: body.text };
}
