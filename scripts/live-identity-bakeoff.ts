import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type EpisodePlan, type StoryBible } from "../src/engine/domain.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { dramaHooks } from "../src/drama-engine/index.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { loadLocalEnv } from "./load-env.ts";
import type { IdentityRefPolicy } from "../src/engine/pipeline/identity-refs.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-bakeoff-c";
const SPEND_CAP = 150;
const SOFT_CAP = 12;

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

async function lockCast(
  app: ReturnType<typeof createEngine>,
  seriesId: string,
  voiceId: string,
  attachWardrobe: boolean,
) {
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: seriesId });
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const diskName = /mara/i.test(character.name) ? "02-character-still.png" : `drama-still-${slug}.png`;
    const body = await readFile(resolve(ROOT, diskName));
    const asset = await app.assets.put({
      id: `bake-c-body-${slug}-${seriesId.slice(0, 6)}`,
      owner_id: OWNER,
      series_id: seriesId,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${seriesId}/bake-c-body-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `bake-c-body-${slug}`,
      metadata: { kind: "full_body", name: character.name },
      created_at: new Date().toISOString(),
    });
    app.store.characters.set(character.id, {
      ...character,
      visual_reference_asset_ids: { full_body: asset.id },
      wardrobe_asset_ids: attachWardrobe ? { everyday: asset.id, home: asset.id } : {},
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
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
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
  const lint = dramaHooks.validateEpisodePlan({
    plan: repaired,
    bible,
    length: "60_90",
    namedCast,
    episodeNumber: 1,
    hookLedgerCloses: 0,
    hookLedgerOpens: 1,
  });
  if (!lint.pass) throw new Error(`Lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);
  const voiceId = (JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id?: string })
    .elevenlabs_voice_id;
  if (!voiceId) throw new Error("assets/voice-id.json is missing");

  const images = createOpenRouterImages();
  const variants: Array<{
    id: string;
    policy: IdentityRefPolicy;
    forceModel: string;
    attachWardrobe: boolean;
    pick: (shots: ReturnType<ReturnType<typeof createEngine>["store"]["shotsForEpisode"]>) => (typeof shots)[number];
  }> = [
    {
      id: "C-mara-wan-face-only",
      policy: "face_only",
      forceModel: "alibaba/wan-3.0",
      attachWardrobe: false,
      pick: (shots) =>
        shots.find((shot) => shot.shot_data.function === "accusation_cu" && shot.shot_data.audio_role === "onscreen")!,
    },
    {
      id: "C-mara-sd25-face-only",
      policy: "face_only",
      forceModel: "bytedance/seedance-2.5",
      attachWardrobe: false,
      pick: (shots) =>
        shots.find((shot) => shot.shot_data.function === "accusation_cu" && shot.shot_data.audio_role === "onscreen")!,
    },
    {
      id: "C-mara-sd25-location-on",
      policy: "face_first",
      forceModel: "bytedance/seedance-2.5",
      attachWardrobe: true,
      pick: (shots) =>
        shots.find((shot) => shot.shot_data.function === "accusation_cu" && shot.shot_data.audio_role === "onscreen")!,
    },
    {
      id: "C-eli-sd25-face-only",
      policy: "face_only",
      forceModel: "bytedance/seedance-2.5",
      attachWardrobe: false,
      pick: (shots) => shots.find((shot) => shot.shot_data.function === "reaction")!,
    },
    {
      id: "C-mara-button-sd25-face-only",
      policy: "face_only",
      forceModel: "bytedance/seedance-2.5",
      attachWardrobe: false,
      pick: (shots) => shots.find((shot) => shot.shot_data.function === "button_cu")!,
    },
  ];

  const generated: Array<Record<string, unknown>> = [];
  let spend = 0.04;
  for (const variant of variants) {
    const ai = createAiGateway({
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
    });
    const app = createEngine({ dailyCap: SPEND_CAP, ai, identityRefPolicy: variant.policy });
    const series = await app.createSeries({
      owner_id: OWNER,
      title: `${bible.title} ${variant.id}`,
      description: bible.logline,
    });
    await app.handleStripeWebhook({
      event_id: `evt_bake_c_${variant.id}_${Date.now()}`,
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: OWNER,
      amount: 40,
    });
    await lockCast(app, series.id, voiceId, variant.attachWardrobe);
    const episode = await app.createEpisode({
      owner_id: OWNER,
      series_id: series.id,
      episode_number: 1,
      title: repaired.title,
    });
    const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "60_90" });
    const shot = variant.pick(planned.shots);
    if (shot.shot_data.function === "button_cu") {
      app.store.shots.set(shot.id, {
        ...shot,
        shot_data: { ...shot.shot_data, speaker: "Mara Voss", speaker_on_camera: "Mara Voss" },
      });
    }
    const live = app.store.shots.get(shot.id)!;
    const seconds = Math.min(6, Math.max(4, live.shot_data.duration_hint_seconds));
    const nextCost = pricing.estimateVideo(variant.forceModel, seconds) + (live.shot_data.dialogue ? 0.01 : 0);
    if (spend + nextCost > SOFT_CAP) {
      generated.push({ id: variant.id, skipped: "soft cap", cost: 0 });
      break;
    }
    const name = `drama-bake-${variant.id}.mp4`;
    process.stdout.write(
      `Bake-off ${variant.id} · ${variant.policy} · ${variant.forceModel} · wardrobe=${variant.attachWardrobe} · ${live.shot_data.function}\n`,
    );
    if (live.shot_data.dialogue) await app.generateDialogue({ owner_id: OWNER, shot_id: live.id });
    const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: live.id, forceModel: variant.forceModel });
    process.stdout.write(
      `  AUDIT first_frame=${job.request_metadata.first_frame_asset_id ?? "none"} kind=${job.request_metadata.first_frame_kind} extra=${job.request_metadata.extra_ref_count ?? "?"} pictured=${job.request_metadata.pictured_name ?? "none"} crop=${job.request_metadata.cu_crop_version ?? "?"}\n`,
    );
    const finished = await poll(app, job.id);
    spend += finished.actual_cost ?? nextCost;
    const assetId = String(finished.result_metadata.asset_id ?? "");
    const stored = assetId ? await app.assets.get(assetId) : null;
    if (stored) await writeFile(resolve(ROOT, name), stored.body);
    const qc = finished.result_metadata.qc as { reasons?: string[] } | undefined;
    generated.push({
      id: variant.id,
      policy: variant.policy,
      model: variant.forceModel,
      location_ref: variant.attachWardrobe,
      function: live.shot_data.function,
      status: finished.status,
      file: name,
      cost: finished.actual_cost ?? nextCost,
      first_frame_kind: finished.request_metadata.first_frame_kind ?? null,
      first_frame_asset_id: finished.request_metadata.first_frame_asset_id ?? null,
      extra_ref_count: finished.request_metadata.extra_ref_count ?? null,
      pictured_name: finished.request_metadata.pictured_name ?? null,
      qc: qc?.reasons ?? [],
      probe: stored ? probeVideoBytes(stored.body) : null,
    });
  }

  const report = {
    ran_at: new Date().toISOString(),
    kind: "identity-bakeoff-c",
    spend_this_pass_usd: Number(spend.toFixed(4)),
    generated,
    note: "Inspect frames. Winner holds Mara (auburn bun, X-scar, ivory turtleneck) and Eli henley without a location-plate teal/navy drift.",
  };
  await writeFile(resolve(ROOT, "drama-bake-c-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ spend_this_pass_usd: report.spend_this_pass_usd, generated: generated.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
