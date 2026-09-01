import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterLlm } from "../src/engine/ai/llm.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type AlignmentTrack, type EpisodePlan, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { decodeJson } from "../src/engine/crypto.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { dramaHooks, isObjectInsert, objectPlateCamera } from "../src/drama-engine/index.ts";
import { containsEditVerb } from "../src/drama-engine/editorial/camera-sanitize.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { isCopyrightFailure } from "../src/engine/jobs/errors.ts";
import { loadLocalEnv } from "./load-env.ts";
import {
  cutEligible,
  resolveIdentityRefPolicy,
  shouldRegenTake,
} from "../src/engine/pipeline/identity-refs.ts";
import { ledgerForEpisode } from "../src/drama-engine/plans/index.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-drama";
const SPEND_CAP = 150;
const VIDEO_SOFT_CAP = 50;
const ARTIFACT = "drama-ship";
const PRIOR_CUMULATIVE = 15.2;
const LEAD = "Mara Voss";
const CU_MODEL = process.env.DRAMA_CU_MODEL?.trim() || "alibaba/wan-3.0";
const REACTION_MODEL = "bytedance/seedance-2.0-mini";
const OBJECT_MODEL = "bytedance/seedance-2.0-mini";

function flatShots(plan: EpisodePlan) {
  return plan.scenes.flatMap((scene) => scene.shots);
}

function modelForShot(shot: Shot): string {
  if (isObjectInsert(shot.shot_data)) return OBJECT_MODEL;
  if (
    shot.shot_data.audio_role === "silent" ||
    shot.shot_data.audio_role === "offscreen" ||
    shot.shot_data.type === "reaction" ||
    shot.shot_data.function === "listener_hold"
  ) {
    return REACTION_MODEL;
  }
  return CU_MODEL;
}

function copyrightSafeCamera(shot: Shot): string {
  if (isObjectInsert(shot.shot_data)) {
    return objectPlateCamera(shot.shot_data.function, "unlabeled handwritten paper TUESDAY", {
      dialogue: "TUESDAY",
    });
  }
  return "Tight single on one face, locked-off, same clothes as reference, no paper, no logo, no readable text";
}

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 12_000));
  }
  throw new Error("Video poll timed out");
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
  process.env.DRAMA_IDENTITY_REF_POLICY = process.env.DRAMA_IDENTITY_REF_POLICY?.trim() || "face_only";
  process.env.DRAMA_CU_MODEL = CU_MODEL;
  await mkdir(ROOT, { recursive: true });
  const policy = resolveIdentityRefPolicy("face_only");
  process.stdout.write(`Identity policy ${policy} · CU model ${CU_MODEL}\n`);

  const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
  const namedCast = bible.characters.map((row) => row.name);
  const existingPlanPath = resolve(ROOT, "09-episode-plan.json");
  let raw: EpisodePlan;
  try {
    if (process.env.LIVE_DRAMA_REPLAN === "1") throw new Error("replan");
    raw = JSON.parse(await readFile(existingPlanPath, "utf8")) as EpisodePlan;
    if (!raw.scenes?.[0]?.shots?.length) throw new Error("empty plan");
    if (process.env.LIVE_DRAMA_REPLAN !== "0" && namedCast.length >= 3) throw new Error("replan");
    process.stdout.write("Reusing assets/09-episode-plan.json (LIVE_DRAMA_REPLAN=0 to keep)…\n");
  } catch {
    const llm = createOpenRouterLlm();
    process.stdout.write("Planning episode 1…\n");
    raw = await llm.writeEpisode({
      bible: { ...bible, rules: SCREENPLAY_RULES },
      episodeNumber: 1,
      episode_length: "60_90",
    });
  }
  const ledger = ledgerForEpisode(1);
  const repaired = dramaHooks.repairEpisodePlan({
    plan: raw,
    bible,
    length: "60_90",
    namedCast,
    episodeNumber: 1,
    ...ledger,
  });
  for (const scene of repaired.scenes) {
    const last = scene.shots.at(-1);
    if (last?.function === "button_cu") {
      last.speaker = LEAD;
      last.speaker_on_camera = LEAD;
    }
    for (const shot of scene.shots) {
      if (isObjectInsert(shot)) {
        shot.camera = objectPlateCamera(shot.function, shot.camera, { dialogue: shot.dialogue });
        shot.speaker_on_camera = null;
      }
    }
  }
  const lint = dramaHooks.validateEpisodePlan({
    plan: repaired,
    bible,
    length: "60_90",
    namedCast,
    episodeNumber: 1,
    ...ledger,
  });
  await writeFile(resolve(ROOT, "09-episode-plan.json"), JSON.stringify(repaired, null, 2));
  const plannedShots = flatShots(repaired);
  const estimate = plannedShots.reduce((sum, shot) => {
    const seconds = Math.min(8, Math.max(4, shot.duration_hint_seconds));
    const model = isObjectInsert(shot) || shot.audio_role === "silent" || shot.type === "reaction"
      ? OBJECT_MODEL
      : CU_MODEL;
    return sum + pricing.estimateVideo(model, seconds);
  }, 0.2);
  process.stdout.write(`Lint ${lint.pass ? "pass" : "FAIL"} · ${plannedShots.length} shots · full-ep estimate $${estimate.toFixed(2)}\n`);
  if (!lint.pass) {
    await writeFile(
      resolve(ROOT, "drama-ship-report.json"),
      JSON.stringify({ lint, spend_estimate_usd: 0, video_generated: false, reason: "lint failed — no video spend" }, null, 2),
    );
    throw new Error(`Drama lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);
  }
  if (estimate > VIDEO_SOFT_CAP) {
    throw new Error(`Estimated $${estimate.toFixed(2)} exceeds soft video cap $${VIDEO_SOFT_CAP}`);
  }

  const voiceId = (
    JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id?: string }
  ).elevenlabs_voice_id;
  if (!voiceId) throw new Error("assets/voice-id.json is missing. Run the live suite G02 first or lock a voice.");

  const images = createOpenRouterImages();
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
  const app = createEngine({ dailyCap: SPEND_CAP, ai, identityRefPolicy: "face_only" });
  const series = await app.createSeries({
    owner_id: OWNER,
    title: bible.title,
    description: bible.logline,
  });
  await app.handleStripeWebhook({
    event_id: `evt_drama_ship_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 80,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  let stillSpend = 0;
  for (const character of analyzed.characters) {
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const diskName = /mara/i.test(character.name) ? "02-character-still.png" : `drama-still-${slug}.png`;
    let body = await readFile(resolve(ROOT, diskName)).catch(() => null);
    if (!body || body.byteLength < 8_000) {
      const generatedStill = await images.generateReference({
        characterName: character.name,
        description: `${character.description}. ${character.appearance_profile.hair}. ${character.appearance_profile.face}. ${character.appearance_profile.default_wardrobe}. Full-body standing plate, one person only, modest clothes.`,
        kind: "full_body",
      });
      stillSpend += 0.04;
      body = Buffer.from(generatedStill.bytes);
      await writeFile(resolve(ROOT, `drama-still-${slug}.png`), generatedStill.bytes);
    }
    const asset = await app.assets.put({
      id: `drama-ship-body-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-ship-body-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-ship-body-${slug}`,
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
  for (const shot of planned.shots) {
    if (shot.shot_data.function === "button_cu") {
      app.store.shots.set(shot.id, {
        ...shot,
        shot_data: { ...shot.shot_data, speaker: LEAD, speaker_on_camera: LEAD },
      });
    }
  }
  const selected = planned.shots.map((shot) => app.store.shots.get(shot.id) ?? shot);
  process.stdout.write(`Generating all ${selected.length} locked takes…\n`);
  const generated: Array<Record<string, unknown> & { shot: Shot; body?: Uint8Array }> = [];
  let spend = 0.12 + stillSpend;
  for (const shot of selected) {
    const live = app.store.shots.get(shot.id) ?? shot;
    const seconds = Math.min(8, Math.max(4, live.shot_data.duration_hint_seconds));
    const model = modelForShot(live);
    const nextCost = pricing.estimateVideo(model, seconds) + (live.shot_data.dialogue ? 0.01 : 0);
    const name = `${ARTIFACT}-${live.shot_data.function ?? live.shot_data.type}-${live.position}.mp4`;
    const dest = resolve(ROOT, name);
    if (spend + nextCost > VIDEO_SOFT_CAP) break;
    const pictured = live.shot_data.speaker_on_camera ?? (isObjectInsert(live.shot_data) ? null : live.shot_data.speaker);
    const character = pictured
      ? [...app.store.charactersFor(series.id)].find((row) => row.name === pictured)
      : null;
    process.stdout.write(
      `AUDIT pos=${live.position} fn=${live.shot_data.function} pictured=${pictured ?? "object"} cu=${character?.visual_reference_asset_ids.cu ?? "pending"} kind=cu extra=0 first_frame=face_only\n`,
    );
    try {
      if (live.shot_data.dialogue) {
        await app.generateDialogue({ owner_id: OWNER, shot_id: live.id });
      }
      let { job } = await app.generateVideo({ owner_id: OWNER, shot_id: live.id, forceModel: model });
      process.stdout.write(
        `  first_frame=${job.request_metadata.first_frame_asset_id ?? "none"} kind=${job.request_metadata.first_frame_kind} extra=${job.request_metadata.extra_ref_count ?? "?"} pictured=${job.request_metadata.pictured_name ?? "none"} crop=${job.request_metadata.cu_crop_version ?? "?"}\n`,
      );
      let finished;
      try {
        finished = await poll(app, job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isCopyrightFailure(message)) throw error;
        process.stdout.write(`  copyright rewrite ${name}\n`);
        const current = app.store.shots.get(live.id)!;
        app.store.shots.set(live.id, {
          ...current,
          shot_data: {
            ...current.shot_data,
            camera: copyrightSafeCamera(current),
            insert_plate_id: null,
          },
        });
        const again = await app.generateVideo({
          owner_id: OWNER,
          shot_id: live.id,
          forceModel: isObjectInsert(current.shot_data) ? OBJECT_MODEL : CU_MODEL,
        });
        finished = await poll(app, again.job.id);
      }
      spend += finished.actual_cost ?? nextCost;
      const qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
      const wanLockedCut =
        model.includes("wan") &&
        qc.length === 1 &&
        qc[0] === "internal_cut" &&
        finished.request_metadata.first_frame_kind === "cu";
      if (!wanLockedCut && shouldRegenTake({ status: finished.status, reasons: qc })) {
        process.stdout.write(`  regen once ${name} (${qc.join(",") || finished.status})\n`);
        const again = await app.regenerateShot({ owner_id: OWNER, shot_id: live.id });
        finished = await poll(app, again.job.id);
        spend += finished.actual_cost ?? nextCost;
      }
      const assetId = String(finished.result_metadata.asset_id ?? "");
      const stored = assetId ? await app.assets.get(assetId) : null;
      const reasons = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
      if (stored) await writeFile(dest, stored.body);
      generated.push({
        shot: app.store.shots.get(live.id) ?? live,
        function: live.shot_data.function,
        audio_role: live.shot_data.audio_role,
        model,
        status: finished.status,
        probe: stored ? probeVideoBytes(stored.body) : null,
        file: name,
        cost: finished.actual_cost ?? nextCost,
        first_frame_kind: finished.request_metadata.first_frame_kind ?? null,
        first_frame_asset_id: finished.request_metadata.first_frame_asset_id ?? null,
        first_frame_qc: finished.request_metadata.first_frame_qc ?? null,
        extra_ref_count: finished.request_metadata.extra_ref_count ?? null,
        pictured_name: finished.request_metadata.pictured_name ?? pictured,
        qc: reasons,
        cut_eligible: Boolean(stored) && cutEligible(reasons),
        body: stored?.body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  skip ${name}: ${message}\n`);
      generated.push({
        shot: live,
        function: live.shot_data.function,
        audio_role: live.shot_data.audio_role,
        model,
        status: "skipped",
        file: name,
        error: message,
        cut_eligible: false,
      });
    }
    if (spend > SPEND_CAP) throw new Error("Hit the $150 OpenRouter cap");
  }

  const eligible = generated.filter((row) => row.cut_eligible && row.body);
  let cutFile: string | null = null;
  let captionFile: string | null = null;
  if (eligible.length > 0) {
    const shots = eligible.map((row) => row.shot);
    const manifest = dramaHooks.buildRenderManifest({
      episode_id: episode.id,
      shots,
      assetIdFor: (shot) => String(generated.find((row) => row.shot.id === shot.id)?.file ?? shot.id),
    });
    const alignments: Array<AlignmentTrack | null> = [];
    for (const shot of shots) {
      const captionId = shot.shot_data.dialogue_alignment_asset_id;
      if (!captionId) {
        alignments.push(null);
        continue;
      }
      const row = await app.assets.get(captionId).catch(() => null);
      alignments.push(row ? decodeJson<AlignmentTrack>(row.body) : null);
    }
    const rendered = await renderEpisodeBytes({
      manifest,
      shotBodies: eligible.map((row) => row.body!),
      alignments,
      ttsBodies: await Promise.all(
        shots.map(async (shot) => {
          const id = shot.shot_data.dialogue_audio_asset_id;
          if (!id) return null;
          const audio = await app.assets.get(id).catch(() => null);
          return audio?.body ?? null;
        }),
      ),
    });
    cutFile = `${ARTIFACT}-cut.mp4`;
    await writeFile(resolve(ROOT, cutFile), rendered.body);
    if (rendered.vtt) {
      captionFile = `${ARTIFACT}-captions.vtt`;
      await writeFile(resolve(ROOT, captionFile), rendered.vtt);
    }
  }

  const cuStills: Array<{ name: string; file: string; crop_version?: unknown }> = [];
  for (const character of app.store.charactersFor(series.id)) {
    const cuId = character.visual_reference_asset_ids.cu;
    if (!cuId) continue;
    const stored = await app.assets.get(cuId).catch(() => null);
    if (!stored) continue;
    const slug = character.name.toLowerCase().replace(/[^a-z]+/g, "-");
    const file = `${ARTIFACT}-cu-${slug}.png`;
    await writeFile(resolve(ROOT, file), stored.body);
    cuStills.push({ name: character.name, file, crop_version: stored.asset.metadata?.crop_version });
  }

  const hookIn = generated.some((row) => row.function === "hook_cu" && row.cut_eligible);
  const buttonIn = generated.some((row) => row.function === "button_cu" && row.cut_eligible);
  const dropped = generated.length - eligible.length;
  const captionCueCount = captionFile
    ? (await readFile(resolve(ROOT, captionFile), "utf8")).split(/\n(?=WEBVTT|\d{2}:)/).length
    : 0;

  const report = {
    ran_at: new Date().toISOString(),
    artifact_prefix: ARTIFACT,
    identity_ref_policy: policy,
    cu_model: CU_MODEL,
    spend_cap_usd: SPEND_CAP,
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    lint_pass: true,
    shot_count: planned.shots.length,
    cut: cutFile,
    captions: captionFile,
    caption_tracks: eligible.filter((row) => row.shot.shot_data.dialogue_alignment_asset_id).length,
    commercial_ready: false,
    commercial_ready_note: "Set true only after frame inspection: one Mara, one Eli, button is Mara, captions present.",
    cu_stills: cuStills,
    generated: generated.map(({ body: _body, shot: _shot, ...rest }) => rest),
    named_cast: namedCast,
    first_line: planned.shots.find((shot) => !shot.shot_data.recap)?.shot_data.dialogue ?? null,
    button_line: planned.shots.at(-1)?.shot_data.dialogue ?? null,
    cut_to_in_camera: planned.shots.some((shot) => containsEditVerb(shot.shot_data.camera)),
    hook_in_cut: hookIn,
    button_in_cut: buttonIn,
    dropped,
    remaining_gaps: [
      "Model identity is never 100%. Drift is judged by eye on the assembled cut.",
      "Seedance 2.5 audio conditioning is unverified — lipsync may slip.",
    ],
    how_to_run: "LIVE_DRAMA_REPLAN=0 DRAMA_IDENTITY_REF_POLICY=face_only DRAMA_CU_MODEL=alibaba/wan-3.0 npm run test:live-drama",
  };
  await writeFile(resolve(ROOT, "drama-ship-report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(ROOT, "drama-pro-report.json"), JSON.stringify(report, null, 2));
  await writeFile(resolve(ROOT, "drama-live-report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        lint_pass: true,
        generated: generated.length,
        cut_eligible: eligible.length,
        spend_this_pass_usd: report.spend_this_pass_usd,
        cut: cutFile,
        captions: captionFile,
        caption_tracks: report.caption_tracks,
        caption_cues: captionCueCount,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  try {
    await writeFile(
      resolve(ROOT, "drama-ship-report.json"),
      JSON.stringify({ ran_at: new Date().toISOString(), lint_pass: false, video_generated: false, error: message }, null, 2),
    );
  } catch {
    /* report is best-effort */
  }
  process.exit(1);
});
