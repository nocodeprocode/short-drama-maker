import type { GenerationStatus } from "../domain.ts";
import type { VideoEngine, VideoSubmitRequest } from "./types.ts";
import { VIDEO_RESOLUTION } from "../config/models.ts";
import { openRouterBytes, openRouterJson, openRouterProvider } from "./openrouter.ts";

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
  if (request.shot.shot_data.dialogue && !request.audio_reference_url && !offscreen) {
    throw new Error("Dialogue video requires a real dialogue-audio URL");
  }
  const input_references: Array<Record<string, unknown>> = request.visual_reference_urls
    .slice(1)
    .map((url) => ({
      type: "image_url",
      image_url: { url },
    }));

  const audioUrl = offscreen ? null : request.audio_reference_url;
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

  const frame = stillUrl(request);
  if (frame) {
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
  if (audioUrl && !offscreen) {
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
      const submitted = await openRouterJson<VideoSubmitResponse>("/videos", {
        method: "POST",
        body: JSON.stringify(payload),
      });
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
      const status = await openRouterJson<VideoStatusResponse>(`/videos/${job.upstream_job_id}`);
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
