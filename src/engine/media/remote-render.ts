import { sha256Hex } from "../crypto.ts";
import { RenderFailedError, renderEpisodeBytes, type RenderFn, type RenderInput, type RenderOutput } from "./render.ts";

export type RemoteRenderConfig = {
  url: string;
  token: string;
  /** Wall-clock budget for one render round trip. 15-minute episodes need many minutes. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const toB64 = (bytes: Uint8Array | null | undefined): string | null =>
  bytes ? Buffer.from(bytes).toString("base64") : null;

/**
 * Renders through the containerized media worker (worker/src/server.ts). The
 * worker runs the same `renderEpisodeBytes`, so output is byte-identical to a
 * local render given the same inputs.
 */
export function createRemoteRender(config: RemoteRenderConfig): RenderFn {
  const base = config.url.replace(/\/$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20 * 60_000;
  return async (input: RenderInput): Promise<RenderOutput> => {
    const response = await fetchImpl(`${base}/render?key=${encodeURIComponent(input.manifest.episode_id)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
        "x-render-key": input.manifest.episode_id,
      },
      body: JSON.stringify({
        manifest: input.manifest,
        shot_bodies_b64: input.shotBodies.map((body) => toB64(body)),
        alignments: input.alignments,
        tts_bodies_b64: input.ttsBodies?.map(toB64),
        native_audio_b64: input.nativeAudio?.map(toB64),
        heard_lanes: input.heardLanes,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      checksum?: string;
      vtt?: string;
      video_b64?: string;
    };
    if (!response.ok) {
      throw new RenderFailedError(`media worker HTTP ${response.status}: ${payload.error ?? "no detail"}`);
    }
    if (!payload.video_b64 || !payload.checksum || typeof payload.vtt !== "string") {
      throw new RenderFailedError("media worker returned no video payload");
    }
    const body = Uint8Array.from(Buffer.from(payload.video_b64, "base64"));
    const checksum = await sha256Hex(body);
    if (checksum !== payload.checksum) {
      throw new RenderFailedError("media worker checksum mismatch (payload corrupted in transit)");
    }
    return { body, checksum, vtt: payload.vtt, container: "mp4" };
  };
}

/** Local ffmpeg unless MEDIA_WORKER_URL + MEDIA_WORKER_TOKEN point at the container. */
export function configuredRender(env: NodeJS.ProcessEnv = process.env): RenderFn {
  const url = env.MEDIA_WORKER_URL?.trim();
  const token = env.MEDIA_WORKER_TOKEN?.trim();
  if (url && token) return createRemoteRender({ url, token });
  return renderEpisodeBytes;
}
