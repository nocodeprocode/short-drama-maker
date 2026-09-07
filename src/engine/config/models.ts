import type { VideoRoute } from "../domain.ts";

export const PRICE_SNAPSHOT_VERSION = "2026-08-31.v1-720p";

/** 720p 9:16 OpenRouter snapshot (31 Aug 2026). Do not use 480p rates. */
export const MODEL_PRICES_PER_SECOND: Record<string, number> = {
  "bytedance/seedance-2.0": 0.08,
  "bytedance/seedance-2.0-mini": 0.076,
  "alibaba/wan-3.0": 0.1,
  "bytedance/seedance-2.5": 0.23,
  "google/veo-3.1-lite": 0.05,
  "kwaivgi/kling-v3.0-std": 0.084,
  "x-ai/grok-imagine-video": 0.07,
};

export const VIDEO_RESOLUTION = "720p";

export const DIALOGUE_TTS_PRICE = 0.004;
export const IMAGE_PRICE = 0.04;
/** Estimate per writer call; Opus bills 5/25 per Mtok, so a plan call lands near this. */
export const LLM_PRICE = 0.02;
export const VOICE_DESIGN_PRICE = 0.12;
/** ElevenLabs bills per character; this is the metered rate used for actuals. */
export const ELEVEN_TTS_PRICE_PER_CHAR = 0.00003;
/** STT billed per audio minute when the provider reports no cost. */
export const STT_PRICE_PER_MINUTE = 0.006;

export const TEXT_MODEL = "anthropic/claude-opus-5";
/** Identity judge: same ZDR-capable family as the writer so one privacy posture covers both. */
export const VISION_MODEL = "anthropic/claude-sonnet-4.6";
/** Per identity judgement (reference + 3 frames). */
export const VISION_PRICE = 0.02;
export const IMAGE_MODEL = "bytedance-seed/seedream-4.5";
export const TTS_MODEL = "eleven_multilingual_v2";
export const VOICE_DESIGN_MODEL = "eleven_ttv_v3";

export const VIDEO_ROUTES: Record<VideoRoute["role"], VideoRoute> = {
  dialogue_default: {
    model: "bytedance/seedance-2.5",
    provider: "openrouter",
    role: "dialogue_default",
    min_duration_seconds: 4,
    max_duration_seconds: 15,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: true,
    region_documented: false,
    strict_privacy_allowed: false,
  },
  economy_default: {
    model: "bytedance/seedance-2.0-mini",
    provider: "openrouter",
    role: "economy_default",
    min_duration_seconds: 4,
    max_duration_seconds: 15,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: false,
    region_documented: false,
    strict_privacy_allowed: false,
  },
  visual_default: {
    model: "bytedance/seedance-2.5",
    provider: "openrouter",
    role: "visual_default",
    min_duration_seconds: 4,
    max_duration_seconds: 15,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: true,
    region_documented: false,
    strict_privacy_allowed: false,
  },
  hero: {
    model: "bytedance/seedance-2.5",
    provider: "openrouter",
    role: "hero",
    min_duration_seconds: 4,
    max_duration_seconds: 15,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: true,
    region_documented: false,
    strict_privacy_allowed: false,
  },
  privacy_fallback: {
    model: "google/veo-3.1-lite",
    provider: "google-vertex",
    role: "privacy_fallback",
    min_duration_seconds: 4,
    max_duration_seconds: 8,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: false,
    region_documented: true,
    strict_privacy_allowed: true,
  },
  action: {
    model: "kwaivgi/kling-v3.0-std",
    provider: "openrouter",
    role: "action",
    min_duration_seconds: 5,
    max_duration_seconds: 8,
    aspect_ratios: ["9:16"],
    audio_conditioning_verified: false,
    region_documented: false,
    strict_privacy_allowed: false,
  },
};

export const ACTION_VIDEO_ROUTE = {
  model: "kwaivgi/kling-v3.0-std",
  provider: "openrouter",
  role: "action" as const,
  min_duration_seconds: 5,
  max_duration_seconds: 8,
  aspect_ratios: ["9:16"] as ["9:16", ...string[]],
  audio_conditioning_verified: false,
  region_documented: false,
  strict_privacy_allowed: false,
  multi_shots: false,
};

export const STANDARD_PRIVACY = {
  zdr: true,
  data_collection: "deny" as const,
  allow_fallbacks: false,
};

export const DIALOGUE_DURATION_WINDOW = {
  min_duration_seconds: 4,
  max_duration_seconds: 10,
};

export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;
export const HEAD_HANDLE_SECONDS = 0.35;
export const TAIL_HANDLE_SECONDS = 0.35;
export const QC_DURATION_TOLERANCE_SECONDS = 0.35;
export const QC_AUTOPILOT_DURATION_TOLERANCE_SECONDS = 2;
export const RETRY_CAP = 3;
/**
 * A video job still pending this long after submit is treated as lost: the
 * reserve is released and the job fails with `pending_timeout` instead of being
 * re-polled forever. Wan/Seedance 720p takes finish in minutes, not hours.
 */
export const VIDEO_PENDING_MAX_SECONDS = 45 * 60;
export const DEFAULT_DAILY_SPEND_CAP = 2000;
export const FAILED_ASSET_TTL_DAYS = 7;
export const INTERMEDIATE_ASSET_TTL_DAYS = 30;
export const SOFT_DELETE_PURGE_DAYS = 30;
export const CANDIDATE_KEEP = 2;
