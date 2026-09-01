import type { AlignmentTrack, VoiceIdentity } from "../domain.ts";
import { TTS_MODEL, VOICE_DESIGN_MODEL } from "../config/models.ts";
import { requireElevenLabsKey } from "./env.ts";
import { providerFetch } from "./http.ts";
import type { DialogueLine, VoiceEngine } from "./types.ts";

const ELEVENLABS_API = "https://api.elevenlabs.io";
/** Voice design and music composition are the slow calls; TTS lines are short. */
const ELEVEN_TIMEOUT_MS = 120_000;

function headers(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("xi-api-key", requireElevenLabsKey());
  headers.set("Content-Type", "application/json");
  return headers;
}

function elevenFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Every ElevenLabs call here is a pure function of its body, so a retried
  // POST after a 429/5xx costs at most one duplicate synthesis, never a paid job.
  return providerFetch(
    `${ELEVENLABS_API}${path}`,
    { ...init, headers: headers(init.headers) },
    { provider: "elevenlabs", label: path, timeoutMs: ELEVEN_TIMEOUT_MS, idempotent: true },
  );
}

async function elevenJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await elevenFetch(path, init);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`ElevenLabs ${path} returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

type DesignResponse = {
  previews?: Array<{
    generated_voice_id?: string;
    audio_base64?: string;
    audio_base_64?: string;
    media_type?: string;
  }>;
};

type CreateVoiceResponse = {
  voice_id?: string;
};

type TimestampResponse = {
  audio_base64?: string;
  audio_base_64?: string;
  alignment?: {
    characters?: string[];
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
  };
};

export function emotionAudioTag(emotion?: string | null, delivery?: string | null): string | null {
  const blob = `${emotion ?? ""} ${delivery ?? ""}`.toLowerCase();
  if (/\b(cry|crying|break|broken|sob)\b/.test(blob)) return "[crying]";
  if (/\b(shout|yell|hot|furious)\b/.test(blob)) return "[shouts]";
  if (/\b(whisper|quiet|under)\b/.test(blob)) return "[whispers]";
  if (/\b(stun|stunned|shock)\b/.test(blob)) return "[stunned]";
  if (/\b(comic|laugh)\b/.test(blob)) return "[surprised]";
  if (/\b(sad|grief)\b/.test(blob)) return "[sad]";
  return null;
}

export function performDialogue(dialogue: { text: string; emotion?: string | null; delivery?: string | null; pace?: string | null }): {
  text: string;
  model: string;
  voice_settings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
} {
  const tag = emotionAudioTag(dialogue.emotion, dialogue.delivery);
  const emotional = Boolean(tag) || /\b(hot|cry|shout|break|pressing)\b/i.test(`${dialogue.emotion ?? ""} ${dialogue.delivery ?? ""}`);
  return {
    text: tag ? `${tag} ${dialogue.text}` : dialogue.text,
    model: emotional ? "eleven_v3" : TTS_MODEL,
    voice_settings: {
      stability: emotional ? 0.28 : 0.45,
      similarity_boost: 0.78,
      style: emotional ? 0.55 : 0.18,
      use_speaker_boost: true,
    },
  };
}

function stripPerformanceTags(track: AlignmentTrack): AlignmentTrack {
  const words = track.words.filter((word) => !/^\s*\[.*\]\s*$/.test(word.word));
  const characters = track.characters.filter((item) => !/[\[\]]/.test(item.char));
  return { ...track, words, characters, text: words.map((word) => word.word).join(" ") };
}

export async function composeElevenMusic(input: {
  prompt: string;
  lengthMs: number;
  instrumental?: boolean;
}): Promise<Uint8Array> {
  const response = await elevenFetch("/v1/music", {
    method: "POST",
    body: JSON.stringify({
      prompt: input.prompt,
      music_length_ms: input.lengthMs,
      model_id: "music_v2",
      force_instrumental: input.instrumental ?? true,
    }),
  });
  return new Uint8Array(await response.arrayBuffer());
}

export async function composeElevenSfx(input: { prompt: string; durationSeconds: number }): Promise<Uint8Array> {
  const response = await elevenFetch("/v1/sound-generation", {
    method: "POST",
    body: JSON.stringify({
      text: input.prompt,
      duration_seconds: input.durationSeconds,
    }),
  });
  return new Uint8Array(await response.arrayBuffer());
}

function alignmentFromEleven(alignment: TimestampResponse["alignment"]): AlignmentTrack {
  const characters = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const chars = characters.map((char, index) => ({
    char,
    start: starts[index] ?? 0,
    end: ends[index] ?? starts[index] ?? 0,
  }));
  const spoken = chars.map((item) => item.char).join("");
  const words: AlignmentTrack["words"] = [];
  let current: typeof chars = [];
  const flush = () => {
    if (current.length === 0) return;
    words.push({
      word: current.map((item) => item.char).join(""),
      start: current[0]!.start,
      end: current.at(-1)!.end,
    });
    current = [];
  };
  for (const item of chars) {
    if (/\s/u.test(item.char)) {
      flush();
    } else {
      current.push(item);
    }
  }
  flush();
  return { text: spoken, characters: chars, words };
}

export function createElevenLabsVoice(): VoiceEngine {
  return {
    async designVoice(description) {
      const designed = await elevenJson<DesignResponse>("/v1/text-to-voice/design", {
        method: "POST",
        body: JSON.stringify({
          voice_description: description,
          model_id: VOICE_DESIGN_MODEL,
          auto_generate_text: true,
        }),
      });
      const previews = designed.previews ?? [];
      if (previews.length === 0) {
        throw new Error("ElevenLabs Voice Design returned no previews");
      }
      const usable = previews
        .map((preview, index) => {
          const audio = preview.audio_base64 ?? preview.audio_base_64;
          if (!preview.generated_voice_id || !audio) return null;
          return {
            preview_id: preview.generated_voice_id,
            elevenlabs_voice_id: preview.generated_voice_id,
            preview_label: String.fromCharCode(65 + index),
            preview_audio_bytes: decodeBase64(audio),
            preview_mime_type: preview.media_type ?? "audio/mpeg",
          };
        })
        .filter((preview): preview is NonNullable<typeof preview> => preview !== null);
      if (usable.length === 0) {
        throw new Error("ElevenLabs Voice Design returned previews without audio or generated_voice_id");
      }
      return usable;
    },

    async saveVoice(candidate, options): Promise<VoiceIdentity> {
      const created = await elevenJson<CreateVoiceResponse>("/v1/text-to-voice", {
        method: "POST",
        body: JSON.stringify({
          voice_name:
            options?.name?.trim() ||
            `sdm-${candidate.preview_label}-${candidate.preview_id.slice(0, 8)}`,
          voice_description:
            options?.description?.trim() ||
            `Fictional adult character voice preview ${candidate.preview_label}`,
          generated_voice_id: candidate.elevenlabs_voice_id,
        }),
      });
      if (!created.voice_id) {
        throw new Error("ElevenLabs did not return a saved voice_id");
      }
      return {
        elevenlabs_voice_id: created.voice_id,
        canonical_reference_asset_id: "",
        voice_version: 1,
      };
    },

    async synthesize(voiceIdentity, dialogue: DialogueLine) {
      const performed = performDialogue(dialogue);
      const body = await elevenJson<TimestampResponse>(
        `/v1/text-to-speech/${voiceIdentity.elevenlabs_voice_id}/with-timestamps`,
        {
          method: "POST",
          body: JSON.stringify({
            text: performed.text,
            model_id: performed.model,
            voice_settings: performed.voice_settings,
          }),
        },
      );
      const audio = body.audio_base64 ?? body.audio_base_64;
      if (!audio) {
        throw new Error("ElevenLabs TTS returned no audio");
      }
      const alignment = stripPerformanceTags(alignmentFromEleven(body.alignment));
      const duration = alignment.characters.at(-1)?.end ?? 0;
      if (duration <= 0) {
        throw new Error("ElevenLabs alignment has no duration");
      }
      return {
        audio: {
          bytes: decodeBase64(audio),
          mime_type: "audio/mpeg",
          duration_seconds: duration,
        },
        alignment: { json: alignment, mime_type: "application/json" },
      };
    },
  };
}
