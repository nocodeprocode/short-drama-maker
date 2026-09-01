import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type AlignmentTrack, type EpisodePlan, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { decodeJson } from "../src/engine/crypto.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { dramaHooks, isObjectInsert } from "../src/drama-engine/index.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { loadLocalEnv } from "./load-env.ts";
import { cutEligible } from "../src/engine/pipeline/identity-refs.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-ship-repair";
const WAN = "alibaba/wan-3.0";

async function poll(app: ReturnType<typeof createEngine>, jobId: string) {
  const started = Date.now();
  const queued = app.getJob(jobId);
  if (queued?.status === "queued") await app.submitVideoJob(queued);
  while (Date.now() - started < 12 * 60 * 1000) {
    const current = app.getJob(jobId);
    if (!current) throw new Error("Job disappeared");
    const after = await app.ingestVideoJob(current);
    process.stdout.write(`  video ${after.status}\n`);
    if (after.status === "completed" || after.status === "needs_review") return after;
    if (after.status === "failed" || after.status === "cancelled") {
      throw new Error(`Video ${after.status}: ${after.error_code ?? "unknown"}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
  }
  throw new Error("Video poll timed out");
}

async function main() {
  loadLocalEnv();
  await mkdir(ROOT, { recursive: true });
  const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
  const raw = JSON.parse(await readFile(resolve(ROOT, "09-episode-plan.json"), "utf8")) as EpisodePlan;
  const namedCast = bible.characters.map((row) => row.name);
  const repaired = dramaHooks.repairEpisodePlan({
    plan: raw,
    bible,
    length: "60_90",
    namedCast,
    episodeNumber: 1,
    hookLedgerCloses: 0,
    hookLedgerOpens: 1,
  });
  const voiceId = (JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id?: string })
    .elevenlabs_voice_id;
  if (!voiceId) throw new Error("voice-id missing");

  const images = createOpenRouterImages();
  const app = createEngine({
    dailyCap: 150,
    identityRefPolicy: "face_only",
    ai: createAiGateway({
      llm: {
        async analyzeStory() {
          return { ...bible, rules: SCREENPLAY_RULES };
        },
        async writeEpisode() {
          return repaired;
        },
        async planShots(input) {
          return input.plan;
        },
      },
      image: images,
      video: createOpenRouterVideo(),
    }),
  });
  const series = await app.createSeries({ owner_id: OWNER, title: bible.title, description: bible.logline });
  await app.handleStripeWebhook({
    event_id: `evt_repair_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 40,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const diskName = /mara/i.test(character.name) ? "02-character-still.png" : `drama-still-${slug}.png`;
    const body = await readFile(resolve(ROOT, diskName));
    const asset = await app.assets.put({
      id: `repair-body-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/repair-body-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `repair-body-${slug}`,
      metadata: { kind: "full_body", name: character.name },
      created_at: new Date().toISOString(),
    });
    app.store.characters.set(character.id, {
      ...character,
      visual_reference_asset_ids: { full_body: asset.id },
      wardrobe_asset_ids: {},
      locked: true,
      voice_profile: {
        ...character.voice_profile,
        elevenlabs_voice_id: voiceId,
        canonical_reference_asset_id: asset.id,
        voice_version: 1,
        locked: true,
      },
    });
  }
  const episode = await app.createEpisode({
    owner_id: OWNER,
    series_id: series.id,
    episode_number: 1,
    title: repaired.title,
  });
  const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "60_90" });
  const targets = planned.shots.filter(
    (shot) =>
      shot.shot_data.speaker_on_camera === "Mara Voss" &&
      shot.shot_data.audio_role === "onscreen" &&
      !isObjectInsert(shot.shot_data) &&
      shot.position <= 4,
  );
  let spend = 0;
  for (const shot of targets) {
    const seconds = Math.min(6, Math.max(4, shot.shot_data.duration_hint_seconds));
    const name = `drama-ship-${shot.shot_data.function}-${shot.position}.mp4`;
    process.stdout.write(`Repair ${name} · Wan face_only · keep internal_cut\n`);
    if (shot.shot_data.dialogue) await app.generateDialogue({ owner_id: OWNER, shot_id: shot.id });
    const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: shot.id, forceModel: WAN });
    const finished = await poll(app, job.id);
    spend += finished.actual_cost ?? pricing.estimateVideo(WAN, seconds);
    const qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
    const assetId = String(finished.result_metadata.asset_id ?? "");
    const stored = assetId ? await app.assets.get(assetId) : null;
    if (stored) await writeFile(resolve(ROOT, name), stored.body);
    process.stdout.write(
      `  kept ${finished.status} qc=${qc.join(",") || "ok"} extra=${finished.request_metadata.extra_ref_count}\n`,
    );
    if (!stored || !cutEligible(qc.filter((reason) => reason !== "internal_cut"))) {
      throw new Error(`Repair take unusable: ${name} ${qc.join(",")}`);
    }
  }

  const keepFiles = [
    "drama-ship-hook_cu-1.mp4",
    "drama-ship-accusation_cu-2.mp4",
    "drama-ship-reaction-3.mp4",
    "drama-ship-accusation_cu-4.mp4",
    "drama-ship-accusation_cu-5.mp4",
    "drama-ship-reaction-6.mp4",
    "drama-ship-reaction-7.mp4",
    "drama-ship-reaction-8.mp4",
    "drama-ship-phone_ui-9.mp4",
    "drama-ship-reaction-10.mp4",
    "drama-ship-button_cu-12.mp4",
  ];
  const shots: Shot[] = [];
  const shotBodies: Uint8Array[] = [];
  const alignments: Array<AlignmentTrack | null> = [];
  const ttsBodies: Array<Uint8Array | null> = [];
  for (const file of keepFiles) {
    const body = await readFile(resolve(ROOT, file));
    shotBodies.push(body);
    const position = Number(file.match(/-(\d+)\.mp4$/)?.[1] ?? "0");
    const shot = planned.shots.find((row) => row.position === position);
    if (!shot) throw new Error(`No planned shot for ${file}`);
    shots.push(shot);
    const captionId = shot.shot_data.dialogue_alignment_asset_id;
    if (captionId) {
      const row = await app.assets.get(captionId).catch(() => null);
      alignments.push(row ? decodeJson<AlignmentTrack>(row.body) : null);
    } else {
      alignments.push(null);
    }
    const audioId = shot.shot_data.dialogue_audio_asset_id;
    if (audioId) {
      const audio = await app.assets.get(audioId).catch(() => null);
      ttsBodies.push(audio?.body ?? null);
    } else {
      ttsBodies.push(null);
    }
  }
  const manifest = dramaHooks.buildRenderManifest({
    episode_id: episode.id,
    shots,
    assetIdFor: (shot) => keepFiles[shots.indexOf(shot)] ?? shot.id,
  });
  const rendered = await renderEpisodeBytes({ manifest, shotBodies, alignments, ttsBodies });
  await writeFile(resolve(ROOT, "drama-ship-cut.mp4"), rendered.body);
  if (rendered.vtt) await writeFile(resolve(ROOT, "drama-ship-captions.vtt"), rendered.vtt);
  await writeFile(
    resolve(ROOT, "drama-ship-repair.json"),
    JSON.stringify(
      {
        spend_usd: Number(spend.toFixed(4)),
        files: keepFiles,
        probes: keepFiles.map((file, index) => ({ file, probe: probeVideoBytes(shotBodies[index]!) })),
        captions: Boolean(rendered.vtt),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ spend_usd: Number(spend.toFixed(4)), takes: keepFiles.length, captions: Boolean(rendered.vtt) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
