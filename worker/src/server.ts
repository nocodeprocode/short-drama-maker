import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mechanicalQc } from "../../src/engine/media/qc.ts";
import { probeVideoBytes } from "../../src/engine/media/probe.ts";
import { RenderFailedError, renderEpisodeBytes } from "../../src/engine/media/render.ts";
import type { AlignmentTrack, RenderManifest } from "../../src/engine/domain.ts";

const port = Number(process.env.PORT ?? 8080);
/** Shared secret; every non-health request must carry it as a bearer token. */
const token = process.env.MEDIA_WORKER_TOKEN?.trim() ?? "";
/** 15-minute episodes at 720p are a few hundred MB of takes; base64 adds a third. */
const MAX_BODY_BYTES = Number(process.env.MEDIA_WORKER_MAX_BODY_BYTES ?? 1_500_000_000);

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  if (!token) return false;
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || presented.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(token));
}

function b64(item: unknown): Uint8Array | null {
  return typeof item === "string" && item.length > 0 ? Uint8Array.from(Buffer.from(item, "base64")) : null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    reply(res, 200, { ok: true, role: "media-worker", auth_configured: Boolean(token) });
    return;
  }

  if (req.method !== "POST") {
    reply(res, 404, { error: "Not found" });
    return;
  }
  if (!authorized(req)) {
    reply(res, 401, { error: token ? "Unauthorized" : "MEDIA_WORKER_TOKEN is not configured on the worker" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (error) {
    reply(res, error instanceof BodyTooLargeError ? 413 : 400, {
      error: error instanceof Error ? error.message : "Invalid body",
    });
    return;
  }

  try {
    if (url.pathname === "/qc") {
      const bytes = b64(body.video_b64);
      if (!bytes) {
        reply(res, 400, { error: "video_b64 is required" });
        return;
      }
      const verdict = mechanicalQc({
        probe: probeVideoBytes(bytes),
        expectedDuration: typeof body.expected_duration === "number" ? body.expected_duration : undefined,
        requireAudio: Boolean(body.require_audio),
        expectedDialogue: typeof body.expected_dialogue === "string" ? body.expected_dialogue : undefined,
        outputTranscript: typeof body.output_transcript === "string" ? body.output_transcript : undefined,
      });
      reply(res, 200, verdict);
      return;
    }

    if (url.pathname === "/render") {
      const manifest = body.manifest as RenderManifest | undefined;
      const bodies = Array.isArray(body.shot_bodies_b64) ? (body.shot_bodies_b64 as unknown[]) : null;
      if (!manifest || !Array.isArray(manifest.shots) || !bodies) {
        reply(res, 400, { error: "manifest and shot_bodies_b64 are required" });
        return;
      }
      const shotBodies = bodies.map((item) => b64(item));
      if (shotBodies.some((item) => item === null)) {
        reply(res, 400, { error: "every shot body must be non-empty base64" });
        return;
      }
      const lanes = Array.isArray(body.heard_lanes) ? (body.heard_lanes as Array<"native" | "tts" | "silent" | null>) : undefined;
      const rendered = await renderEpisodeBytes({
        manifest,
        shotBodies: shotBodies as Uint8Array[],
        alignments: Array.isArray(body.alignments) ? (body.alignments as Array<AlignmentTrack | null>) : [],
        ttsBodies: Array.isArray(body.tts_bodies_b64) ? (body.tts_bodies_b64 as unknown[]).map(b64) : undefined,
        nativeAudio: Array.isArray(body.native_audio_b64) ? (body.native_audio_b64 as unknown[]).map(b64) : undefined,
        heardLanes: lanes,
      });
      reply(res, 200, {
        checksum: rendered.checksum,
        bytes: rendered.body.byteLength,
        vtt: rendered.vtt,
        container: rendered.container,
        video_b64: Buffer.from(rendered.body).toString("base64"),
      });
      return;
    }

    reply(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof RenderFailedError) {
      reply(res, 422, { error: error.message, code: "render_failed" });
      return;
    }
    reply(res, 500, { error: error instanceof Error ? error.message : "worker_failed" });
  }
}).listen(port, () => {
  console.log(JSON.stringify({ event: "media_worker_listening", port, auth_configured: Boolean(token) }));
});

class BodyTooLargeError extends Error {
  constructor() {
    super(`Body exceeds ${MAX_BODY_BYTES} bytes`);
    this.name = "BodyTooLargeError";
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
