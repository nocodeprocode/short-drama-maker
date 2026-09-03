import { assertSafeKey, verifyAssetAccess } from "../../../src/engine/storage/sign.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function objectKey(pathname: string): string {
  const prefix = "/o/";
  if (!pathname.startsWith(prefix)) throw new Error("Invalid path");
  const key = decodeURIComponent(pathname.slice(prefix.length));
  assertSafeKey(key);
  return key;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, role: "media-store" });
    }

    try {
      const key = objectKey(url.pathname);
      if (request.method === "GET") {
        const exp = Number(url.searchParams.get("exp"));
        const sig = url.searchParams.get("sig") ?? "";
        const ok = await verifyAssetAccess(env.MEDIA_SIGNING_SECRET, "GET", key, exp, sig);
        if (!ok) return json({ error: "Invalid or expired signature" }, 401);
        const object = await env.MEDIA.get(key);
        if (!object) return json({ error: "Not found" }, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "private, max-age=60");
        return new Response(object.body, { headers });
      }

      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token || token !== env.MEDIA_STORE_TOKEN) {
        return json({ error: "Unauthorized" }, 401);
      }

      // Multipart: a 15-minute master or a programme stem is well past a single
      // request body, so large objects arrive as parts and are completed in one step.
      const uploadId = url.searchParams.get("uploadId");
      if (request.method === "POST" && url.searchParams.has("uploads")) {
        const upload = await env.MEDIA.createMultipartUpload(key, {
          httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
        });
        return json({ ok: true, key, uploadId: upload.uploadId });
      }
      if (request.method === "PUT" && uploadId) {
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!Number.isInteger(partNumber) || partNumber < 1 || !request.body) return json({ error: "Bad part" }, 400);
        const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
        const part = await upload.uploadPart(partNumber, request.body);
        return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
      }
      if (request.method === "POST" && uploadId) {
        const body = (await request.json()) as { parts?: Array<{ partNumber: number; etag: string }> };
        if (!Array.isArray(body.parts) || !body.parts.length) return json({ error: "No parts" }, 400);
        const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
        await upload.complete(body.parts);
        return json({ ok: true, key });
      }
      if (request.method === "DELETE" && uploadId) {
        await env.MEDIA.resumeMultipartUpload(key, uploadId).abort();
        return json({ ok: true, key, aborted: uploadId });
      }

      if (request.method === "PUT") {
        await env.MEDIA.put(key, request.body, {
          httpMetadata: {
            contentType: request.headers.get("content-type") ?? "application/octet-stream",
          },
        });
        return json({ ok: true, key });
      }

      if (request.method === "DELETE") {
        await env.MEDIA.delete(key);
        return json({ ok: true, key });
      }

      return json({ error: "Method not allowed" }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return json({ error: message }, 400);
    }
  },
} satisfies ExportedHandler<Env>;
