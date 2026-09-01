import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { mediaStoreConfigured } from "../src/engine/storage/create.ts";
import { signedGetUrl } from "../src/engine/storage/sign.ts";
import type { Shot } from "../src/engine/domain.ts";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();
if (!mediaStoreConfigured()) throw new Error("media store not configured");

const still = new Uint8Array(await readFile("assets/02-character-still.png"));
const audio = new Uint8Array(await readFile("assets/04-dialogue.mp3"));
const base = process.env.MEDIA_STORE_URL!.replace(/\/$/, "");
const token = process.env.MEDIA_STORE_TOKEN!;
const secret = process.env.MEDIA_SIGNING_SECRET!;

async function put(key: string, mime: string, bytes: Uint8Array) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${base}/o/${encoded}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": mime },
    body: Buffer.from(bytes),
  });
  if (!res.ok) throw new Error(`PUT ${key} HTTP ${res.status}`);
  return signedGetUrl(base, secret, key, 3600);
}

const stillUrl = await put("validate/02-character-still.png", "image/png", still);
const audioUrl = await put("validate/04-dialogue.mp3", "audio/mpeg", audio);
const shot: Shot = {
  id: "long",
  scene_id: "sc",
  position: 1,
  selected_generation_id: null,
  status: "audio_ready",
  shot_data: {
    type: "dialogue",
    speaker: "Mara",
    dialogue: "You knew about this for three months.",
    emotion: "controlled",
    delivery: "quiet",
    pace: "slow",
    camera: "medium close-up",
    mouth_visibility_required: true,
    duration_hint_seconds: 15,
    duration_seconds: 15,
    dialogue_audio_asset_id: "a",
    dialogue_alignment_asset_id: "b",
    hero: false,
  },
};

const video = createOpenRouterVideo();
const prompt =
  "Mara Voss, fictional adult architect, early thirties, dark auburn hair in a bun, small scar above left brow. Same woman as the first-frame reference. 9:16 penthouse kitchen at night. Loose ivory high-neck tunic, modest cardigan, charcoal wide-leg trousers. No celebrity. Not a real person.";

process.stdout.write("submitting wan-3.0 15s with still…\n");
const submitted = await video.submit({
  shot,
  prompt,
  visual_reference_urls: [stillUrl],
  audio_reference_url: audioUrl,
  duration_seconds: 15,
  model: "alibaba/wan-3.0",
  privacy_profile: "standard",
  callback_url: "https://example.invalid/openrouter-callback",
});
process.stdout.write(`job ${submitted.upstream_job_id}\n`);

const started = Date.now();
while (Date.now() - started < 10 * 60 * 1000) {
  const status = await video.getStatus({
    upstream_job_id: submitted.upstream_job_id,
    provider: "openrouter",
    model: "alibaba/wan-3.0",
  });
  process.stdout.write(`status ${status.status}\n`);
  if (status.status === "completed") {
    const file = await video.download({
      upstream_job_id: submitted.upstream_job_id,
      provider: "openrouter",
      model: "alibaba/wan-3.0",
    });
    const path = resolve("assets/06-wan-15s.mp4");
    await writeFile(path, Buffer.from(file.bytes));
    process.stdout.write(`wrote ${file.bytes.byteLength} ${path}\n`);
    process.exit(0);
  }
  if (status.status === "failed" || status.status === "cancelled" || status.status === "expired") {
    throw new Error(`${status.status}: ${status.error}`);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 15000));
}
throw new Error("timed out");
