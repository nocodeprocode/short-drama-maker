import type { GenerationStatus } from "../domain.ts";
import type { VideoEngine, VideoSubmitRequest } from "./types.ts";
import { isSceneTake } from "../../drama-engine/types/editorial.ts";
import { VIDEO_RESOLUTION } from "../config/models.ts";
import { OPENROUTER_TIMEOUTS_MS, openRouterBytes, openRouterJson, openRouterProvider } from "./openrouter.ts";

type VideoSubmitResponse = {
  id?: string;
  polling_url?: string;
  status?: string;
  error?: string;
};

type VideoStatusResponse = {
  id?: string;
  status?: string;
  unsigned_urls?: string[];
  error?: string | { message?: string };
  usage?: { cost?: number };
};

export type AudioAttachStyle =
  | "openrouter_audio_url"
  | "alibaba_media"
  | "alibaba_reference_audio_urls"
  | "both";

export const DEFAULT_AUDIO_ATTACH: AudioAttachStyle = "alibaba_media";

function errorText(error: VideoStatusResponse["error"]): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  return error.message ?? JSON.stringify(error);
}

function mapStatus(status: string | undefined): GenerationStatus["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "pending";
  }
}

function stillUrl(request: VideoSubmitRequest): string | undefined {
  return request.visual_reference_urls[0];
}

function seedanceIdentity(request: VideoSubmitRequest): boolean {
  return String(request.model).includes("seedance") && request.visual_reference_urls.length > 0;
}

function imageRefs(urls: string[]): Array<Record<string, unknown>> {
  return urls.map((url) => ({
    type: "image_url",
    image_url: { url },
  }));
}

export function buildVideoSubmitPayload(
  request: VideoSubmitRequest,
  audioStyle: AudioAttachStyle = DEFAULT_AUDIO_ATTACH,
): Record<string, unknown> {
  const duration = Math.max(1, Math.round(request.duration_seconds));
  const provider: Record<string, unknown> = { ...openRouterProvider("video") };
  const offscreen =
    request.shot.shot_data.audio_role === "offscreen" ||
    request.shot.shot_data.function === "listener_hold" ||
    request.shot.shot_data.audio_role === "silent";
  const nativeScene =
    isSceneTake(request.shot.shot_data) || String(request.model).includes("seedance");
  if (request.shot.shot_data.dialogue && !request.audio_reference_url && !offscreen && !nativeScene) {
    throw new Error("Dialogue video requires a real dialogue-audio URL");
  }
  const seedanceRefs = seedanceIdentity(request);
  const input_references: Array<Record<string, unknown>> = seedanceRefs
    ? imageRefs(request.visual_reference_urls)
    : imageRefs(request.visual_reference_urls.slice(1));
  // Never attach a previous take. Seedance reprints that blocking as the same scene.

  const audioUrl = offscreen || nativeScene ? null : request.audio_reference_url;
  if (audioUrl && (audioStyle === "openrouter_audio_url" || audioStyle === "both")) {
    input_references.push({
      type: "audio_url",
      audio_url: { url: audioUrl },
    });
  }

  if (audioUrl && (audioStyle === "alibaba_media" || audioStyle === "both")) {
    const media: Array<Record<string, string>> = [];
    const frame = stillUrl(request);
    if (frame) media.push({ type: "first_frame", url: frame });
    media.push({ type: "reference_audio", url: audioUrl });
    provider.options = {
      alibaba: { parameters: { media } },
    };
  }

  if (audioUrl && audioStyle === "alibaba_reference_audio_urls") {
    provider.options = {
      alibaba: { parameters: { reference_audio_urls: [audioUrl] } },
    };
  }

  if (String(request.model).includes("kling")) {
    const options = (provider.options as Record<string, unknown> | undefined) ?? {};
    const kling = (options.kwaivgi as { parameters?: Record<string, unknown> } | undefined) ?? {};
    provider.options = {
      ...options,
      kwaivgi: { parameters: { ...kling.parameters, multi_shots: false } },
    };
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    duration,
    resolution: VIDEO_RESOLUTION,
    aspect_ratio: "9:16",
    provider,
  };
  if (request.callback_url) payload.callback_url = request.callback_url;
  if (typeof request.seed === "number" && Number.isFinite(request.seed)) {
    payload.seed = Math.trunc(request.seed) & 0x7fffffff;
  }

  const frame = stillUrl(request);
  // Seedance treats frame_images and input_references as exclusive.
  // frame_images wins and drops the face stills, which is why the cast morphs.
  if (frame && !seedanceRefs) {
    payload.frame_images = [
      {
        type: "image_url",
        image_url: { url: frame },
        frame_type: "first_frame",
      },
    ];
  }
  if (input_references.length > 0) {
    payload.input_references = input_references;
  }
  if (nativeScene || (audioUrl && !offscreen)) {
    payload.generate_audio = true;
  } else if (offscreen) {
    payload.generate_audio = false;
  }
  return payload;
}

export function payloadContainsAudioUrl(payload: Record<string, unknown>, url: string): boolean {
  return JSON.stringify(payload).includes(url);
}

export function createOpenRouterVideo(audioStyle: AudioAttachStyle = DEFAULT_AUDIO_ATTACH): VideoEngine {
  return {
    async submit(request) {
      const payload = buildVideoSubmitPayload(request, audioStyle);
      // Never auto-retry a submit: a duplicate is a second paid render. The job
      // layer retries with its own idempotency key once the failure is classified.
      const submitted = await openRouterJson<VideoSubmitResponse>(
        "/videos",
        { method: "POST", body: JSON.stringify(payload) },
        { timeoutMs: OPENROUTER_TIMEOUTS_MS.submit, retries: 0 },
      );
      if (!submitted.id) {
        throw new Error(`OpenRouter video submit returned no id: ${JSON.stringify(submitted)}`);
      }
      return {
        upstream_job_id: submitted.id,
        provider: "openrouter",
        model: request.model,
      };
    },

    async getStatus(job) {
      if (!job.upstream_job_id) {
        throw new Error("Missing upstream_job_id");
      }
      const status = await openRouterJson<VideoStatusResponse>(`/videos/${job.upstream_job_id}`, {}, {
        timeoutMs: OPENROUTER_TIMEOUTS_MS.poll,
      });
      return {
        upstream_job_id: job.upstream_job_id,
        status: mapStatus(status.status),
        output_url: status.unsigned_urls?.[0] ?? null,
        actual_cost: status.usage?.cost ?? null,
        error: errorText(status.error),
      };
    },

    async download(job) {
      if (!job.upstream_job_id) {
        throw new Error("Missing upstream_job_id");
      }
      const file = await openRouterBytes(`/videos/${job.upstream_job_id}/content?index=0`);
      if (file.bytes.byteLength === 0) {
        throw new Error("OpenRouter returned empty video bytes");
      }
      return {
        bytes: file.bytes,
        mime_type: file.mime_type.includes("video") ? file.mime_type : "video/mp4",
      };
    },
  };
}
