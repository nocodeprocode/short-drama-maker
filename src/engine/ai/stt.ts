import { STT_PRICE_PER_MINUTE } from "../config/models.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
import { openRouterJson } from "./openrouter.ts";

/** MP3 at ~128 kbps; only used to meter cost when the provider reports none. */
const APPROX_MP3_BYTES_PER_SECOND = 16_000;

export type Transcript = {
  text: string;
  /** Word or segment timings when the provider returns them. */
  words: Array<{ word: string; start: number; end: number }>;
  /** First spoken word, seconds from the start of the audio; null when no timings came back. */
  speech_onset_seconds: number | null;
};

type VerboseTranscription = {
  text?: string;
  usage?: { cost?: number };
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
};

function timingsFrom(body: VerboseTranscription): Transcript["words"] {
  if (Array.isArray(body.words) && body.words.length) {
    return body.words
      .filter((row) => typeof row.start === "number" && typeof row.end === "number")
      .map((row) => ({ word: String(row.word ?? "").trim(), start: row.start!, end: row.end! }));
  }
  if (Array.isArray(body.segments) && body.segments.length) {
    return body.segments
      .filter((row) => typeof row.start === "number" && typeof row.end === "number")
      .map((row) => ({ word: String(row.text ?? "").trim(), start: row.start!, end: row.end! }));
  }
  return [];
}

/**
 * Wan's native audio carries room tone and ambience before the line, so a level
 * detector fires on the kitchen, not the voice. The transcript's first word
 * timing is the speech onset the sync gate needs.
 */
export async function transcribeAudio(input: {
  bytes: Uint8Array;
  format: string;
}): Promise<Transcript> {
  const data = Buffer.from(input.bytes).toString("base64");
  const body = await openRouterJson<VerboseTranscription>("/audio/transcriptions", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.OPENROUTER_STT_MODEL?.trim() || "openai/whisper-large-v3",
      input_audio: { data, format: input.format },
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
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
  const words = timingsFrom(body).filter((row) => row.word.replace(/[^\p{L}\p{N}]/gu, "").length > 0);
  const onset = words.length ? Number(words[0]!.start.toFixed(3)) : null;
  return { text: body.text, words, speech_onset_seconds: onset };
}
