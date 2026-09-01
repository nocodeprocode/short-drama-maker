import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElevenLabsVoice } from "../src/engine/ai/elevenlabs.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterLlm } from "../src/engine/ai/llm.ts";
import { openRouterJson } from "../src/engine/ai/openrouter.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { IMAGE_MODEL, TEXT_MODEL, VIDEO_ROUTES } from "../src/engine/config/models.ts";
import type { Shot } from "../src/engine/domain.ts";
import { mediaStoreConfigured } from "../src/engine/storage/create.ts";
import { signedGetUrl } from "../src/engine/storage/sign.ts";
import { loadLocalEnv } from "./load-env.ts";

const ROOT = resolve(process.cwd(), "assets");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.local`);
  return value;
}

function mask(value: string): string {
  if (value.length <= 8) return "(set)";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function writeBytes(rel: string, body: Uint8Array | string): Promise<string> {
  const path = resolve(ROOT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof body === "string" ? body : Buffer.from(body));
  return path;
}

async function existingFile(rel: string): Promise<string | null> {
  const path = resolve(ROOT, rel);
  try {
    const info = await stat(path);
    return info.size > 0 ? path : null;
  } catch {
    return null;
  }
}

type ElevenVoice = {
  voice_id?: string;
  name?: string;
  category?: string;
};

async function listElevenVoices(): Promise<ElevenVoice[]> {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs /v1/voices failed HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const body = JSON.parse(text) as { voices?: ElevenVoice[] };
  return body.voices ?? [];
}

function dataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function publishMedia(key: string, mime: string, bytes: Uint8Array): Promise<string> {
  if (!mediaStoreConfigured()) return dataUrl(mime, bytes);
  const base = process.env.MEDIA_STORE_URL!.replace(/\/$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const put = await fetch(`${base}/o/${encoded}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${process.env.MEDIA_STORE_TOKEN}`,
      "content-type": mime,
    },
    body: Buffer.from(bytes),
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`Media store PUT failed HTTP ${put.status}: ${text.slice(0, 200)}`);
  }
  return signedGetUrl(base, process.env.MEDIA_SIGNING_SECRET!, key, 60 * 60);
}

type VideoModel = {
  id?: string;
  supported_durations?: number[];
  supported_aspect_ratios?: string[];
  allowed_passthrough_parameters?: string[];
  generate_audio?: boolean;
};

async function stripeProbe(): Promise<{ object: string; livemode: boolean; count: number }> {
  const key = required("STRIPE_SECRET_KEY");
  if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) {
    throw new Error("Stripe key is not a test key. Validation must use rk_test_ or sk_test_.");
  }
  const response = await fetch("https://api.stripe.com/v1/customers?limit=1", {
    headers: { authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Stripe /v1/customers failed HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const body = JSON.parse(text) as { object?: string; data?: unknown[] };
  return {
    object: body.object ?? "list",
    livemode: false,
    count: body.data?.length ?? 0,
  };
}

async function videoModel(id: string): Promise<VideoModel> {
  const body = await openRouterJson<{ data?: VideoModel[] }>("/videos/models", { method: "GET" });
  const match = body.data?.find((row) => row.id === id);
  if (!match) throw new Error(`OpenRouter videos/models did not include ${id}`);
  return match;
}

async function pollVideo(jobId: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  while (Date.now() - started < 8 * 60 * 1000) {
    const status = await openRouterJson<Record<string, unknown>>(`/videos/${jobId}`);
    const state = String(status.status ?? "pending");
    process.stdout.write(`video status: ${state}\n`);
    if (state === "completed") return status;
    if (state === "failed" || state === "cancelled" || state === "expired") {
      throw new Error(`Video ${state}: ${JSON.stringify(status.error ?? status)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
  }
  throw new Error("Video poll timed out after 8 minutes");
}

function shot(dialogue: string): Shot {
  return {
    id: "validate-shot",
    scene_id: "validate-scene",
    position: 1,
    selected_generation_id: null,
    status: "audio_ready",
    shot_data: {
      type: "dialogue",
      speaker: "Mara",
      dialogue,
      emotion: "controlled",
      delivery: "quiet",
      pace: "slow",
      camera: "medium close-up, 9:16, kitchen night",
      mouth_visibility_required: true,
      duration_hint_seconds: 4,
      duration_seconds: 4,
      dialogue_audio_asset_id: "audio",
      dialogue_alignment_asset_id: "align",
      hero: false,
    },
  };
}

async function main() {
  loadLocalEnv();
  required("OPENROUTER_API_KEY");
  required("ELEVENLABS_API_KEY");
  required("STRIPE_SECRET_KEY");

  await mkdir(ROOT, { recursive: true });
  const report: Record<string, unknown> = {
    started_at: new Date().toISOString(),
    keys_present: {
      OPENROUTER_API_KEY: mask(process.env.OPENROUTER_API_KEY!),
      ELEVENLABS_API_KEY: mask(process.env.ELEVENLABS_API_KEY!),
      STRIPE_SECRET_KEY: mask(process.env.STRIPE_SECRET_KEY!),
    },
    models: {
      text: TEXT_MODEL,
      image: IMAGE_MODEL,
      video: VIDEO_ROUTES.economy_default.model,
    },
    media_store_configured: mediaStoreConfigured(),
  };

  process.stdout.write("1/5 Stripe test API…\n");
  const stripe = await stripeProbe();
  report.stripe = stripe;

  process.stdout.write("2/5 OpenRouter story bible…\n");
  const llm = createOpenRouterLlm();
  const existingBible = await existingFile("01-story-bible.json");
  const bible = existingBible
    ? (JSON.parse(await readFile(existingBible, "utf8")) as Awaited<ReturnType<typeof llm.analyzeStory>>)
    : await llm.analyzeStory({
        title: "Kitchen After Midnight",
        idea: "Two fictional adults, Mara Voss and Eli Hart, confront a three-month lie in a penthouse kitchen. No celebrities. Dialogue only.",
      });
  const biblePath = existingBible ?? (await writeBytes("01-story-bible.json", JSON.stringify(bible, null, 2)));
  report.bible = { title: bible.title, characters: bible.characters.map((row) => row.name), reused: Boolean(existingBible) };

  const lead = bible.characters[0];
  if (!lead) throw new Error("Bible had no characters");

  process.stdout.write("3/5 OpenRouter character still…\n");
  const images = createOpenRouterImages();
  const existingStill = await existingFile("02-character-still.png");
  const still = existingStill
    ? { bytes: new Uint8Array(await readFile(existingStill)), mime_type: "image/png" }
    : await images.generateReference({
        characterName: lead.name,
        description: [
          lead.description,
          lead.appearance.hair,
          lead.appearance.face,
          lead.appearance.default_wardrobe,
          "Fully modest public clothing: long-sleeve blouse, full-length trousers, closed shoes, high neckline, no sleepwear.",
        ].join(". "),
        kind: "front",
      });
  const stillPath = existingStill ?? (await writeBytes("02-character-still.png", still.bytes));
  report.image = { bytes: still.bytes.byteLength, mime_type: still.mime_type, reused: Boolean(existingStill) };

  process.stdout.write("4/5 ElevenLabs voice + TTS…\n");
  const speech = createElevenLabsVoice();
  let previewPath: string | null = await existingFile("03-voice-preview.mp3");
  let voiceId = "";
  let voiceSource = "voice_design";
  try {
    const candidates = await speech.designVoice(
      lead.voice_design_prompt ||
        "Fictional adult woman, late twenties, conversational American English, controlled and intimate.",
    );
    const preview = candidates[0];
    if (!preview) throw new Error("ElevenLabs returned no voice previews");
    previewPath = await writeBytes("03-voice-preview.mp3", preview.preview_audio_bytes);
    const saved = await speech.saveVoice(preview, {
      name: `sdm-validate-${lead.name.replace(/\s+/g, "-").slice(0, 24)}`,
      description: lead.voice_design_prompt,
    });
    voiceId = saved.elevenlabs_voice_id;
    report.voice_design = { preview_count: candidates.length, saved: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("feature_not_available") && !message.includes("paid plan")) {
      throw error;
    }
    const voices = await listElevenVoices();
    const chosen =
      voices.find((voice) => /sarah/i.test(voice.name ?? "") && voice.category === "premade") ??
      voices.find((voice) => voice.category === "premade" && voice.voice_id);
    if (!chosen?.voice_id) throw new Error("ElevenLabs returned no usable premade voices");
    voiceId = chosen.voice_id;
    voiceSource = "premade_library";
    report.voice_design = {
      blocked: true,
      reason: "Voice Design API requires a paid ElevenLabs plan",
      fallback_voice: chosen.name,
    };
  }
  const line = "You knew about this for three months.";
  const spoken = await speech.synthesize(
    {
      elevenlabs_voice_id: voiceId,
      canonical_reference_asset_id: "validate",
      voice_version: 1,
    },
    {
      speaker: lead.name,
      text: line,
      emotion: "furious_but_controlled",
      delivery: "quiet",
      pace: "slow",
      scene_id: "validate",
    },
  );
  const audioPath = await writeBytes("04-dialogue.mp3", spoken.audio.bytes);
  const alignPath = await writeBytes(
    "04-dialogue-alignment.json",
    JSON.stringify(spoken.alignment.json, null, 2),
  );
  report.voice = {
    source: voiceSource,
    spoken_seconds: spoken.audio.duration_seconds,
    alignment_chars: spoken.alignment.json.characters.length,
    alignment_text: spoken.alignment.json.text,
  };

  process.stdout.write("5/5 OpenRouter economy video…\n");
  const modelId = VIDEO_ROUTES.economy_default.model;
  const model = await videoModel(modelId);
  const duration = model.supported_durations?.includes(4)
    ? 4
    : (model.supported_durations?.[0] ?? 4);
  report.video_model = {
    id: model.id,
    supported_durations: model.supported_durations,
    supported_aspect_ratios: model.supported_aspect_ratios,
    allowed_passthrough_parameters: model.allowed_passthrough_parameters,
    generate_audio: model.generate_audio,
  };

  let videoPath: string | null = await existingFile("05-shot.mp4");
  if (!videoPath) {
    try {
      const stillUrl = await publishMedia(
        "validate/02-character-still.png",
        still.mime_type,
        still.bytes,
      );
      const audioUrl = await publishMedia(
        "validate/04-dialogue.mp3",
        spoken.audio.mime_type,
        spoken.audio.bytes,
      );
      report.media_store = {
        configured: mediaStoreConfigured(),
        still_url_kind: stillUrl.startsWith("https://") ? "https" : "data",
        audio_url_kind: audioUrl.startsWith("https://") ? "https" : "data",
      };
      const video = createOpenRouterVideo();
      const modestPrompt = `${lead.name}, fictional adult character, not a real person, 9:16 kitchen at night, speaking the line, medium close-up. Fully modest public clothing: loose long sleeves, covered legs, closed neckline, no sleepwear.`;
      let submitted;
      try {
        submitted = await video.submit({
          shot: shot(line),
          prompt: modestPrompt,
          visual_reference_urls: [stillUrl],
          audio_reference_url: audioUrl,
          duration_seconds: duration,
          model: modelId,
          privacy_profile: "standard",
          callback_url: "https://example.invalid/openrouter-callback",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/real person|SensitiveContent|PrivacyInformation/i.test(message)) throw error;
        report.video_image_rejected = message.slice(0, 240);
        submitted = await video.submit({
          shot: shot(line),
          prompt: modestPrompt,
          visual_reference_urls: [],
          audio_reference_url: audioUrl,
          duration_seconds: duration,
          model: modelId,
          privacy_profile: "standard",
          callback_url: "https://example.invalid/openrouter-callback",
        });
      }
      report.video_job_id = submitted.upstream_job_id;
      const status = await pollVideo(submitted.upstream_job_id);
      const downloaded = await video.download({
        upstream_job_id: submitted.upstream_job_id,
        provider: "openrouter",
        model: modelId,
      });
      videoPath = await writeBytes("05-shot.mp4", downloaded.bytes);
      report.video = {
        bytes: downloaded.bytes.byteLength,
        mime_type: downloaded.mime_type,
        usage: status.usage ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.video = {
        blocked: true,
        reason: message,
        dashboard: "https://openrouter.ai/settings/privacy",
        note: "Every video model 404s while account-level ZDR / data policy excludes non-ZDR video endpoints. Video is not ZDR-eligible.",
      };
    }
  }

  const files: Record<string, string> = {
    bible: biblePath,
    still: stillPath,
    dialogue: audioPath,
    alignment: alignPath,
  };
  if (previewPath) files.voice_preview = previewPath;
  if (videoPath) files.video = videoPath;
  report.files = Object.fromEntries(
    Object.entries(files).map(([key, path]) => [key, pathToFileURL(path).href]),
  );
  report.finished_at = new Date().toISOString();
  const reportPath = await writeBytes("report.json", JSON.stringify(report, null, 2));

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Short Drama Maker — live artifacts</title>
<body style="font-family:ui-sans-serif,system-ui;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5">
  <h1>Live provider artifacts</h1>
  <p>These files were generated by real Stripe, OpenRouter, and ElevenLabs calls. Nothing here is mocked.</p>
  <h2>Story bible</h2>
  <p><a href="./01-story-bible.json">01-story-bible.json</a></p>
  <h2>Character still</h2>
  <img src="./02-character-still.png" alt="Character still" style="width:100%;max-width:360px;border-radius:12px" />
  ${previewPath ? `<h2>Voice design preview</h2>\n  <audio controls src="./03-voice-preview.mp3"></audio>` : `<h2>Voice design</h2><p>Blocked on this ElevenLabs plan. Dialogue below used a premade library voice via the real TTS API.</p>`}
  <h2>Dialogue line</h2>
  <p>${line}</p>
  <audio controls src="./04-dialogue.mp3"></audio>
  <p><a href="./04-dialogue-alignment.json">alignment JSON</a></p>
  <h2>Economy video</h2>
  ${videoPath ? `<video controls src="./05-shot.mp4" style="width:100%;max-width:360px;border-radius:12px"></video>` : `<p>Blocked by the OpenRouter account privacy policy. Video providers are not ZDR-eligible. Open <a href="https://openrouter.ai/settings/privacy">openrouter.ai/settings/privacy</a> and allow non-ZDR video endpoints, then rerun <code>npm run validate:providers</code>.</p>`}
  <p><a href="./report.json">report.json</a></p>
</body>
</html>
`;
  const htmlPath = await writeBytes("index.html", html);

  process.stdout.write("\nArtifacts written:\n");
  for (const [key, path] of Object.entries({ ...files, report: reportPath, gallery: htmlPath })) {
    process.stdout.write(`  ${key}: ${pathToFileURL(path).href}\n`);
  }
  if (report.video && typeof report.video === "object" && "blocked" in report.video) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
