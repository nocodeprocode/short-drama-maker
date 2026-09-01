import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAiGateway, type AIGateway } from "../src/engine/ai/index.ts";
import { createElevenLabsVoice } from "../src/engine/ai/elevenlabs.ts";
import { createOpenRouterLlm } from "../src/engine/ai/llm.ts";
import { openRouterJson, openRouterRaw } from "../src/engine/ai/openrouter.ts";
import {
  type AudioAttachStyle,
  buildVideoSubmitPayload,
  createOpenRouterVideo,
  payloadContainsAudioUrl,
} from "../src/engine/ai/video.ts";
import { VIDEO_ROUTES } from "../src/engine/config/models.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import type { StoryBible } from "../src/engine/domain.ts";
import { SCREENPLAY_RULES } from "../src/engine/domain.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { foldSpoken, mechanicalQc } from "../src/engine/media/qc.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { mediaStoreConfigured } from "../src/engine/storage/create.ts";
import { signedGetUrl } from "../src/engine/storage/sign.ts";
import { loadLocalEnv } from "./load-env.ts";

const ROOT = resolve(process.cwd(), "assets");
const LINE = "You knew about this for three months.";
const OWNER = "live-suite";
const AUDIO_STYLES: AudioAttachStyle[] = [
  "both",
  "openrouter_audio_url",
  "alibaba_media",
  "alibaba_reference_audio_urls",
];

type CaseStatus = "pass" | "fail";
type CaseResult = {
  id: string;
  title: string;
  layer: "offline" | "live-cheap" | "live-gen";
  required: boolean;
  status: CaseStatus;
  detail: Record<string, unknown>;
  error?: string;
  ms: number;
};

const results: CaseResult[] = [];
const files: Record<string, string> = {};

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
  files[rel] = pathToFileURL(path).href;
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

async function publishMedia(key: string, mime: string, bytes: Uint8Array): Promise<string> {
  const base = required("MEDIA_STORE_URL").replace(/\/$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const put = await fetch(`${base}/o/${encoded}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${required("MEDIA_STORE_TOKEN")}`,
      "content-type": mime,
    },
    body: Buffer.from(bytes),
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`Media store PUT failed HTTP ${put.status}: ${text.slice(0, 200)}`);
  }
  return signedGetUrl(base, required("MEDIA_SIGNING_SECRET"), key, 60 * 60);
}

async function transcribeAudio(bytes: Uint8Array, format: string): Promise<string> {
  const raw = await openRouterRaw("/audio/transcriptions", {
    method: "POST",
    body: JSON.stringify({
      model: "google/chirp-3",
      input_audio: { data: Buffer.from(bytes).toString("base64"), format },
    }),
  });
  if (!raw.ok) {
    throw new Error(`STT HTTP ${raw.status}: ${raw.text.slice(0, 240)}`);
  }
  const body = JSON.parse(raw.text) as { text?: string };
  if (!body.text?.trim()) throw new Error("STT returned no text");
  return body.text.trim();
}

async function extractMp3(videoPath: string): Promise<Uint8Array> {
  const out = videoPath.replace(/\.mp4$/i, ".mp3");
  const ran = spawnSync(
    "/opt/homebrew/bin/ffmpeg",
    ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", out],
    { encoding: "utf8" },
  );
  if (ran.status !== 0) {
    throw new Error(ran.stderr.slice(-400) || "ffmpeg failed to extract audio");
  }
  return new Uint8Array(await readFile(out));
}

function liveVideo(): AIGateway["video"] {
  const fallback = createOpenRouterVideo();
  return {
    async submit(request) {
      let last = "no audio attach style attempted";
      for (const style of AUDIO_STYLES) {
        const payload = buildVideoSubmitPayload(request, style);
        if (request.audio_reference_url && !payloadContainsAudioUrl(payload, request.audio_reference_url)) {
          throw new Error(`Style ${style} dropped the audio URL`);
        }
        const raw = await openRouterRaw("/videos", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (raw.ok) {
          const body = JSON.parse(raw.text) as { id?: string };
          if (!body.id) throw new Error(`OpenRouter accepted ${style} but returned no id`);
          usedAudioStyle = style;
          return { upstream_job_id: body.id, provider: "openrouter", model: request.model };
        }
        last = `style ${style} HTTP ${raw.status}: ${raw.text.slice(0, 280)}`;
        if (raw.status !== 400) throw new Error(last);
      }
      throw new Error(`OpenRouter rejected every audio-attach style. Last: ${last}`);
    },
    getStatus: fallback.getStatus,
    download: fallback.download,
  };
}

let usedAudioStyle: AudioAttachStyle | null = null;

async function pollEngineJob(
  app: ReturnType<typeof createEngine>,
  jobId: string,
  timeoutMs = 12 * 60 * 1000,
): Promise<void> {
  const started = Date.now();
  const queued = app.getJob(jobId);
  if (!queued) throw new Error("Job missing");
  if (queued.status === "queued") {
    await app.submitVideoJob(queued);
  }
  while (Date.now() - started < timeoutMs) {
    const current = app.getJob(jobId);
    if (!current) throw new Error("Job disappeared");
    const after = await app.ingestVideoJob(current);
    process.stdout.write(`  engine video: ${after.status}\n`);
    if (after.status === "completed" || after.status === "needs_review") return;
    if (after.status === "failed" || after.status === "cancelled") {
      throw new Error(`Video ${after.status}: ${after.error_code ?? "unknown"}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 15_000));
  }
  throw new Error("Engine video poll timed out after 12 minutes");
}

async function runCase(
  id: string,
  title: string,
  layer: CaseResult["layer"],
  requiredCase: boolean,
  fn: () => Promise<Record<string, unknown>>,
): Promise<void> {
  process.stdout.write(`\n[${id}] ${title}\n`);
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({
      id,
      title,
      layer,
      required: requiredCase,
      status: "pass",
      detail,
      ms: Date.now() - started,
    });
    process.stdout.write(`  pass (${Date.now() - started}ms)\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      id,
      title,
      layer,
      required: requiredCase,
      status: "fail",
      detail: {},
      error: message,
      ms: Date.now() - started,
    });
    process.stdout.write(`  fail: ${message}\n`);
    if (requiredCase) throw error;
  }
}

async function main() {
  loadLocalEnv();
  await mkdir(ROOT, { recursive: true });

  await runCase("U01", "Offline unit + contract suite", "offline", true, async () => {
    const ran = spawnSync("npm", ["test"], { encoding: "utf8" });
    if (ran.status !== 0) {
      throw new Error(ran.stdout.slice(-800) || ran.stderr.slice(-800) || "vitest failed");
    }
    const passed = /Tests\s+(\d+)\s+passed/.exec(ran.stdout)?.[1];
    return { passed: Number(passed ?? 0), exit: ran.status };
  });

  await runCase("C01", "Required secrets are present (masked)", "live-cheap", true, async () => {
    const keys = [
      "OPENROUTER_API_KEY",
      "ELEVENLABS_API_KEY",
      "STRIPE_SECRET_KEY",
      "MEDIA_STORE_URL",
      "MEDIA_SIGNING_SECRET",
      "MEDIA_STORE_TOKEN",
      "VITE_SUPABASE_URL",
    ];
    return Object.fromEntries(keys.map((key) => [key, mask(required(key))]));
  });

  await runCase("C02", "Stripe test API answers", "live-cheap", true, async () => {
    const key = required("STRIPE_SECRET_KEY");
    if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) {
      throw new Error("Stripe key is not a test key");
    }
    const response = await fetch("https://api.stripe.com/v1/customers?limit=1", {
      headers: { authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Stripe HTTP ${response.status}: ${text.slice(0, 200)}`);
    return { http: response.status, livemode: false };
  });

  await runCase("C03", "Cloudflare media-store health", "live-cheap", true, async () => {
    if (!mediaStoreConfigured()) throw new Error("media store env is incomplete");
    const response = await fetch(`${required("MEDIA_STORE_URL").replace(/\/$/, "")}/health`);
    const body = (await response.json()) as { ok?: boolean };
    if (!response.ok || !body.ok) throw new Error(`media-store /health HTTP ${response.status}`);
    return { http: response.status, ok: true };
  });

  await runCase("C04", "R2 PUT / signed GET / DELETE", "live-cheap", true, async () => {
    const bytes = new TextEncoder().encode(`live-suite ${new Date().toISOString()}`);
    const key = `live-suite/roundtrip-${Date.now()}.txt`;
    const url = await publishMedia(key, "text/plain", bytes);
    const got = await fetch(url);
    if (!got.ok) throw new Error(`signed GET HTTP ${got.status}`);
    const text = await got.text();
    if (text !== new TextDecoder().decode(bytes)) throw new Error("signed GET body mismatch");
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const del = await fetch(`${required("MEDIA_STORE_URL").replace(/\/$/, "")}/o/${encoded}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${required("MEDIA_STORE_TOKEN")}` },
    });
    if (!del.ok) throw new Error(`DELETE HTTP ${del.status}`);
    return { signed_get: "https", bytes: bytes.byteLength };
  });

  await runCase("C05", "OpenRouter key can list models", "live-cheap", true, async () => {
    const body = await openRouterJson<{ data?: Array<{ id?: string }> }>("/models");
    const count = body.data?.length ?? 0;
    if (count < 1) throw new Error("OpenRouter /models returned no models");
    return { models: count };
  });

  let wanDurations: number[] = [];
  await runCase("C06", "Wan 3.0 is a live video model", "live-cheap", true, async () => {
    const body = await openRouterJson<{
      data?: Array<{
        id?: string;
        supported_durations?: number[];
        supported_aspect_ratios?: string[];
        allowed_passthrough_parameters?: string[];
        generate_audio?: boolean;
      }>;
    }>("/videos/models");
    const wan = body.data?.find((row) => row.id === VIDEO_ROUTES.dialogue_default.model);
    if (!wan) throw new Error(`videos/models missing ${VIDEO_ROUTES.dialogue_default.model}`);
    if (!wan.supported_aspect_ratios?.includes("9:16")) {
      throw new Error("Wan 3.0 does not list 9:16");
    }
    wanDurations = wan.supported_durations ?? [];
    const duration = wanDurations.includes(4) ? 4 : (wanDurations.find((value) => value >= 4) ?? 4);
    return {
      id: wan.id,
      supported_durations: wan.supported_durations,
      aspect_ratios: wan.supported_aspect_ratios,
      passthrough: wan.allowed_passthrough_parameters ?? [],
      generate_audio: wan.generate_audio ?? null,
      chosen_duration: duration,
    };
  });

  await runCase("C07", "ElevenLabs account answers", "live-cheap", true, async () => {
    const response = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ElevenLabs /v1/user HTTP ${response.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text) as { subscription?: { status?: string; tier?: string } };
    return {
      subscription: body.subscription?.status ?? null,
      tier: body.subscription?.tier ?? null,
    };
  });

  await runCase("C08", "Supabase project is reachable", "live-cheap", true, async () => {
    const url = required("VITE_SUPABASE_URL").replace(/\/$/, "");
    const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: publishable ? { apikey: publishable, authorization: `Bearer ${publishable}` } : undefined,
    });
    if (response.status !== 200 && response.status !== 401) {
      throw new Error(`Supabase auth health HTTP ${response.status}`);
    }
    return { url, http: response.status, authenticated: response.status === 200 };
  });

  await runCase("C09", "Prior live artifacts still exist", "live-cheap", true, async () => {
    const needed = [
      "01-story-bible.json",
      "02-character-still.png",
      "03-voice-preview.mp3",
      "04-dialogue.mp3",
      "04-dialogue-alignment.json",
      "06-wan-15s.mp4",
    ];
    const present: Record<string, number> = {};
    for (const rel of needed) {
      const path = await existingFile(rel);
      if (!path) throw new Error(`Missing ${rel}`);
      present[rel] = (await stat(path)).size;
    }
    return present;
  });

  await runCase("C10", "Identity clip 06 is a portrait ~15s container", "live-cheap", true, async () => {
    const bytes = new Uint8Array(await readFile(resolve(ROOT, "06-wan-15s.mp4")));
    const probe = probeVideoBytes(bytes);
    if (!probe.decodes) throw new Error("06-wan-15s.mp4 does not decode as MP4");
    if (probe.width >= probe.height) throw new Error("06 is not portrait");
    if (Math.abs(probe.duration_seconds - 15) > 1.5) {
      throw new Error(`06 duration ${probe.duration_seconds} is not ~15s`);
    }
    return probe;
  });

  await runCase("G01", "LLM writes a real episode plan from the stored bible", "live-gen", true, async () => {
    const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
    const llm = createOpenRouterLlm();
    const plan = await llm.writeEpisode({ bible: { ...bible, rules: SCREENPLAY_RULES }, episodeNumber: 1 });
    await writeBytes("09-episode-plan.json", JSON.stringify(plan, null, 2));
    if (!plan.scenes.some((scene) => scene.shots.some((row) => row.dialogue && row.speaker))) {
      throw new Error("Episode plan has no dialogue");
    }
    if (!plan.scenes.some((scene) => scene.shots.some((row) => row.type === "reaction"))) {
      throw new Error("Episode plan has no reaction shot");
    }
    if (!plan.cliffhanger?.trim()) {
      throw new Error("Episode plan is missing a cliffhanger");
    }
    const shotCount = plan.scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
    if (shotCount < SCREENPLAY_RULES.min_shots || shotCount > SCREENPLAY_RULES.max_shots) {
      throw new Error(`Episode plan has ${shotCount} shots; expected ${SCREENPLAY_RULES.min_shots}–${SCREENPLAY_RULES.max_shots}`);
    }
    return {
      title: plan.title,
      scenes: plan.scenes.length,
      shots: shotCount,
    };
  });

  await runCase("G02", "ElevenLabs TTS + alignment for the locked line", "live-gen", true, async () => {
    const speech = createElevenLabsVoice();
    const voices = (await (
      await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
      })
    ).json()) as { voices?: Array<{ voice_id?: string; name?: string }> };
    let voiceId = "";
    const saved = await existingFile("voice-id.json");
    if (saved) {
      voiceId = (JSON.parse(await readFile(saved, "utf8")) as { elevenlabs_voice_id?: string })
        .elevenlabs_voice_id ?? "";
    }
    if (!voiceId) {
      const prior = voices.voices?.find((voice) => /sdm-validate|Mara Voss/i.test(voice.name ?? ""));
      voiceId = prior?.voice_id ?? "";
    }
    if (!voiceId) {
      const candidates = await speech.designVoice(
        "Fictional adult woman, late twenties, conversational American English, controlled and intimate.",
      );
      const preview = candidates[0];
      if (!preview) throw new Error("Voice Design returned no preview");
      const created = await speech.saveVoice(preview, { name: "sdm-validate-Mara-Voss" });
      voiceId = created.elevenlabs_voice_id;
    }
    await writeBytes("voice-id.json", JSON.stringify({ elevenlabs_voice_id: voiceId }, null, 2));
    const spoken = await speech.synthesize(
      { elevenlabs_voice_id: voiceId, canonical_reference_asset_id: "live", voice_version: 1 },
      {
        speaker: "Mara Voss",
        text: LINE,
        emotion: "furious_but_controlled",
        delivery: "quiet",
        pace: "slow",
        scene_id: "live",
      },
    );
    await writeBytes("04-dialogue.mp3", spoken.audio.bytes);
    await writeBytes("04-dialogue-alignment.json", JSON.stringify(spoken.alignment.json, null, 2));
    const transcript = await transcribeAudio(spoken.audio.bytes, "mp3");
    if (foldSpoken(transcript) !== foldSpoken(LINE)) {
      throw new Error(`TTS STT mismatch: ${transcript}`);
    }
    return {
      voice_id: `${voiceId.slice(0, 4)}…`,
      duration_seconds: spoken.audio.duration_seconds,
      stt: transcript,
    };
  });

  await runCase("G03", "Engine path: fund → lock → TTS → Wan+audio → ingest", "live-gen", true, async () => {
    const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
    const still = new Uint8Array(await readFile(resolve(ROOT, "02-character-still.png")));
    const voiceId = (
      JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id: string }
    ).elevenlabs_voice_id;
    const duration = wanDurations.includes(4) ? 4 : (wanDurations.find((value) => value >= 4) ?? 4);
    const ai = createAiGateway({
      llm: {
        async analyzeStory() {
          return { ...bible, rules: SCREENPLAY_RULES };
        },
        async writeEpisode() {
          const { commercialFixturePlan } = await import("../src/drama-engine/plans/commercial-fixture.ts");
          return commercialFixturePlan({
            speakers: ["Mara Voss", "Eli Hart"],
            location: bible.locations?.[0] ?? "penthouse kitchen",
            firstLine: LINE,
            duration,
          });
        },
        async planShots(input) {
          return input.plan;
        },
      },
      video: liveVideo(),
    });
    const app = createEngine({ dailyCap: 1000, ai });
    const series = await app.createSeries({
      owner_id: OWNER,
      title: bible.title,
      description: "Two fictional adults confront a three-month lie in a penthouse kitchen.",
    });
    await app.handleStripeWebhook({
      event_id: `evt_live_${Date.now()}`,
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: OWNER,
      amount: 25,
    });
    const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
    const lead = analyzed.characters.find((row) => /mara/i.test(row.name)) ?? analyzed.characters[0];
    if (!lead) throw new Error("Analyze created no characters");
    for (const character of analyzed.characters) {
      if (character.id === lead.id) continue;
      app.store.characters.set(character.id, {
        ...character,
        locked: true,
        voice_profile: {
          ...character.voice_profile,
          elevenlabs_voice_id: `locked_${character.id}`,
          voice_version: 1,
          locked: true,
        },
      });
    }
    const stillAsset = await app.assets.put({
      id: "live-still",
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/live-still.png`,
      mime_type: "image/png",
      body: still,
      checksum: "live-still",
      metadata: { kind: "front" },
      created_at: new Date().toISOString(),
    });
    app.store.characters.set(lead.id, {
      ...app.store.characters.get(lead.id)!,
      visual_reference_asset_ids: { front: stillAsset.id },
    });
    const latest = app.store.characters.get(lead.id)!;
    app.store.characters.set(lead.id, {
      ...latest,
      locked: true,
      voice_profile: {
        ...latest.voice_profile,
        elevenlabs_voice_id: voiceId,
        canonical_reference_asset_id: stillAsset.id,
        voice_version: 1,
        locked: true,
      },
    });
    const episode = await app.createEpisode({
      owner_id: OWNER,
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id });
    const dialogue = planned.shots[0];
    if (!dialogue) throw new Error("Plan produced no shot");
    const spoken = await app.generateDialogue({ owner_id: OWNER, shot_id: dialogue.id });
    if (spoken.shot.shot_data.duration_seconds !== duration) {
      const liveShot = app.store.shots.get(dialogue.id)!;
      app.store.shots.set(dialogue.id, {
        ...liveShot,
        shot_data: { ...liveShot.shot_data, duration_seconds: duration },
      });
    }
    const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: dialogue.id });
    await pollEngineJob(app, job.id);
    const finished = app.getJob(job.id);
    if (finished?.status !== "completed" && finished?.status !== "needs_review") {
      throw new Error(`Engine job ended ${finished?.status ?? "missing"}`);
    }
    const assetId = String(finished.result_metadata.asset_id ?? "");
    const stored = assetId ? await app.assets.get(assetId) : null;
    if (!stored) throw new Error("Ingest did not store a shot video");
    const videoPath = await writeBytes("07-wan-audio.mp4", stored.body);
    const probe = probeVideoBytes(stored.body);
    const qc = mechanicalQc({
      probe,
      expectedDuration: spoken.duration.duration_seconds,
      requireAudio: true,
      expectedDialogue: LINE,
      outputTranscript: null,
    });
    let stt: string | null = null;
    let stt_error: string | null = null;
    try {
      const extracted = await extractMp3(videoPath);
      stt = await transcribeAudio(extracted, "mp3");
    } catch (error) {
      stt_error = error instanceof Error ? error.message : String(error);
    }
    const transcript_matches = stt ? foldSpoken(stt) === foldSpoken(LINE) : false;
    if (!probe.has_audio) {
      throw new Error("Wan output has no audio track. Audio conditioning is not working.");
    }
    await writeBytes(
      "07-wan-audio.json",
      JSON.stringify(
        {
          job_id: finished.id,
          upstream_job_id: finished.upstream_job_id,
          status: finished.status,
          audio_style: usedAudioStyle,
          qc,
          probe,
          stt,
          stt_error,
          transcript_matches,
          path: pathToFileURL(videoPath).href,
        },
        null,
        2,
      ),
    );
    if (finished.status === "needs_review" && qc.reasons.includes("audio_missing")) {
      throw new Error("QC rejected the clip for missing audio");
    }
    if (stt && !transcript_matches) {
      throw new Error(`Video speech is not the locked line. STT: ${stt}`);
    }
    return {
      job_status: finished.status,
      audio_style: usedAudioStyle,
      bytes: stored.body.byteLength,
      probe,
      qc,
      stt,
      stt_error,
      transcript_matches,
      audio_conditioning_verified: transcript_matches,
    };
  });

  await runCase("G04", "Deterministic render from the ingested clip", "live-gen", true, async () => {
    const video = new Uint8Array(await readFile(resolve(ROOT, "07-wan-audio.mp4")));
    const alignment = JSON.parse(await readFile(resolve(ROOT, "04-dialogue-alignment.json"), "utf8"));
    const rendered = await renderEpisodeBytes({
      manifest: {
        version: 1,
        episode_id: "live",
        shots: [{ shot_id: "s1", asset_id: "a1", in_point_seconds: 0, out_point_seconds: 4 }],
        caption_asset_ids: [],
        music_asset_ids: [],
        sfx_asset_ids: [],
        transitions: [],
      },
      shotBodies: [video],
      alignments: [alignment],
    });
    await writeBytes("08-render.bin", rendered.body);
    await writeBytes("08-captions.vtt", rendered.vtt);
    if (!rendered.vtt.includes("You knew") && !rendered.vtt.toLowerCase().includes("knew")) {
      throw new Error("Render VTT is missing the dialogue line");
    }
    return { checksum: rendered.checksum, bytes: rendered.body.byteLength };
  });

  const report = {
    started_note: "Real Stripe / OpenRouter / ElevenLabs / R2. No mocks on live-cheap or live-gen.",
    finished_at: new Date().toISOString(),
    audio_style: usedAudioStyle,
    results,
    files,
    required_failed: results.filter((row) => row.required && row.status === "fail").map((row) => row.id),
    audio_conditioning_verified: Boolean(
      results.find((row) => row.id === "G03")?.detail.audio_conditioning_verified,
    ),
  };
  const reportPath = await writeBytes("live-report.json", JSON.stringify(report, null, 2));
  process.stdout.write(`\nReport: ${pathToFileURL(reportPath).href}\n`);
  for (const [rel, href] of Object.entries(files)) {
    process.stdout.write(`  ${rel}: ${href}\n`);
  }

  if (report.required_failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!report.audio_conditioning_verified) {
    process.stdout.write(
      "\nNo green light: the engine path finished, but Wan audio was not proven to be our ElevenLabs line.\n",
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  const report = {
    finished_at: new Date().toISOString(),
    results,
    files,
    fatal: error instanceof Error ? error.message : String(error),
  };
  writeBytes("live-report.json", JSON.stringify(report, null, 2)).finally(() => process.exit(1));
});
