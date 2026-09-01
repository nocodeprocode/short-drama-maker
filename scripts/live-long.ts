import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterLlm } from "../src/engine/ai/llm.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type EpisodePlan, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { dramaHooks, isObjectInsert, objectPlateCamera } from "../src/drama-engine/index.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { isCopyrightFailure } from "../src/engine/jobs/errors.ts";
import { loadLocalEnv } from "./load-env.ts";
import { cutEligible, resolveIdentityRefPolicy, shouldRegenTake } from "../src/engine/pipeline/identity-refs.ts";
import { commercialLongPlan, planLongFormEpisode, synthesizeBlockShots } from "../src/drama-engine/plans/long-form.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-long";
const SPEND_CAP = 150;
const SLICE_SOFT = 22;
const PRIOR_CUMULATIVE = 23.95;
const ARTIFACT = "drama-long";
const SLICE_BLOCKS = [0, 1, 2];
const LEAD = "Mara Voss";
const CU_MODEL = process.env.DRAMA_CU_MODEL?.trim() || "alibaba/wan-3.0";
const REACTION_MODEL = "bytedance/seedance-2.0-mini";
const OBJECT_MODEL = "bytedance/seedance-2.0-mini";

const MARA_LOCK =
  "Tight single on Mara Voss only — dark auburn bun, small X-scar above the left brow, ivory turtleneck, no charcoal shirt, no navy, one face, locked-off";
const ELI_LOCK =
  "Tight single on Eli Hart only — charcoal henley with two buttons at the throat placket, not a turtleneck, not a crew-neck sweater, not navy, one face, locked-off";

const OBJECT_POOL = [
  "drama-ship-hook_cu-1.mp4",
  "drama-ship-phone_ui-9.mp4",
  "drama-pro-phone_ui-9.mp4",
  "drama-id-phone_ui-9.mp4",
  "drama-final-phone_ui-9.mp4",
];
const ELI_POOL = [
  "drama-ship-reaction-3.mp4",
  "drama-ship-reaction-10.mp4",
  "drama-pro-reaction-3.mp4",
  "drama-ship-reaction-7.mp4",
  "drama-final-reaction-3.mp4",
];
const MARA_CU_POOL = [
  "drama-ship-accusation_cu-2.mp4",
  "drama-ship-accusation_cu-4.mp4",
  "drama-pro-accusation_cu-4.mp4",
  "drama-final-accusation_cu-2.mp4",
  "drama-final-accusation_cu-5.mp4",
  "drama-show-accusation_cu-2.mp4",
];

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
  if (/eli/i.test(shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker ?? "")) return ELI_LOCK;
  if (/mara/i.test(shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker ?? "")) return MARA_LOCK;
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

async function readPool(names: string[], used: Set<string>): Promise<Uint8Array | null> {
  for (const name of names) {
    if (used.has(name)) continue;
    const body = await readFile(resolve(ROOT, name)).catch(() => null);
    if (body && body.byteLength > 8_000 && body[4] === 0x66) {
      used.add(name);
      return body;
    }
  }
  for (const name of names) {
    const body = await readFile(resolve(ROOT, name)).catch(() => null);
    if (body && body.byteLength > 8_000 && body[4] === 0x66) return body;
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function commercialPlan(bible: StoryBible): Promise<EpisodePlan> {
  const namedCast = bible.characters.map((row) => row.name);
  const llm = createOpenRouterLlm();
  let raw: EpisodePlan;
  try {
    raw = await withTimeout(
      planLongFormEpisode({
        bible,
        episodeNumber: 1,
        title: bible.title,
        outlineEpisode: (input) =>
          withTimeout(llm.outlineEpisode!({ ...input, episode_length: "900_1080" }), 45_000, "outlineEpisode"),
        writeEpisodeBlocks: async (input) =>
          input.blocks.map((block) =>
            synthesizeBlockShots({
              block,
              bible,
              lastBlock: block.index === input.outline.blocks.length - 1,
            }),
          ),
      }),
      55_000,
      "planLongFormEpisode",
    );
  } catch (error) {
    process.stdout.write(`LLM long plan failed (${error instanceof Error ? error.message : error}); synthesizing.\n`);
    raw = commercialLongPlan(bible);
  }
  const repaired = dramaHooks.repairEpisodePlan({
    plan: raw,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  const lint = dramaHooks.validateEpisodePlan({
    plan: repaired,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  if (lint.pass) return repaired;
  process.stdout.write(`LLM/repair lint failed (${lint.blocking.map((row) => row.id).join(", ")}); using commercial fixture.\n`);
  const fallback = dramaHooks.repairEpisodePlan({
    plan: commercialLongPlan(bible),
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  const again = dramaHooks.validateEpisodePlan({
    plan: fallback,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  if (!again.pass) {
    throw new Error(`Commercial long plan failed lint: ${again.blocking.map((row) => row.id).join(", ")}`);
  }
  return fallback;
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
  process.env.DRAMA_IDENTITY_REF_POLICY = process.env.DRAMA_IDENTITY_REF_POLICY?.trim() || "face_only";
  process.env.DRAMA_CU_MODEL = CU_MODEL;
  await mkdir(ROOT, { recursive: true });
  const policy = resolveIdentityRefPolicy("face_only");
  process.stdout.write(`Long-form path · identity ${policy} · CU ${CU_MODEL} · blocks ${SLICE_BLOCKS.join(",")}\n`);

  const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
  const namedCast = bible.characters.map((row) => row.name);
  const plan = await commercialPlan({ ...bible, rules: bible.rules ?? SCREENPLAY_RULES });
  const lint = dramaHooks.validateEpisodePlan({
    plan,
    bible,
    length: "900_1080",
    namedCast,
    episodeNumber: 1,
  });
  await writeFile(resolve(ROOT, `${ARTIFACT}-plan.json`), JSON.stringify(plan, null, 2));
  const shots = plan.scenes.flatMap((scene) => scene.shots);
  const sum = shots.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  process.stdout.write(
    `Plan lint ${lint.pass ? "pass" : "FAIL"} · ${plan.outline?.blocks.length ?? plan.scenes.length} blocks · ${shots.length} shots · ${sum.toFixed(0)}s\n`,
  );
  if (!lint.pass) throw new Error(`Drama lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);

  const voiceId = (
    JSON.parse(await readFile(resolve(ROOT, "voice-id.json"), "utf8")) as { elevenlabs_voice_id?: string }
  ).elevenlabs_voice_id;
  if (!voiceId) throw new Error("assets/voice-id.json is missing.");

  const images = createOpenRouterImages();
  const ai = createAiGateway({
    llm: {
      async analyzeStory() {
        return { ...bible, rules: SCREENPLAY_RULES };
      },
      async writeEpisode() {
        return plan;
      },
      async planShots(input) {
        return input.plan;
      },
      async outlineEpisode() {
        return plan.outline!;
      },
      async writeEpisodeBlocks(input) {
        return plan.scenes.filter((scene) => input.blocks.some((block) => block.index === scene.block_index));
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
    event_id: `evt_drama_long_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 80,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  let spend = 0.15;
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
      spend += 0.04;
      body = Buffer.from(generatedStill.bytes);
    }
    const asset = await app.assets.put({
      id: `drama-long-body-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-long-body-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-long-body-${slug}`,
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
    title: plan.title,
  });
  const planned = await app.planEpisode({ owner_id: OWNER, episode_id: episode.id, episode_length: "900_1080" });
  const slice = planned.shots.filter((shot) => SLICE_BLOCKS.includes(shot.shot_data.block_index ?? -1));
  process.stdout.write(`Engine planned ${planned.shots.length} shots · slice ${slice.length} from blocks ${SLICE_BLOCKS.join(",")}\n`);

  const usedFiles = new Set<string>();
  const takes: Array<Record<string, unknown> & { shot: Shot; reused: boolean }> = [];

  for (const [index, shot] of slice.entries()) {
    const live = app.store.shots.get(shot.id) ?? shot;
    const pictured = live.shot_data.speaker_on_camera ?? live.shot_data.speaker;
    if (/mara/i.test(pictured ?? "") && live.shot_data.function !== "hook_cu") {
      app.store.shots.set(live.id, {
        ...live,
        shot_data: { ...live.shot_data, speaker: LEAD, speaker_on_camera: LEAD, camera: MARA_LOCK },
      });
    } else if (/eli/i.test(pictured ?? "") && !live.shot_data.dialogue) {
      app.store.shots.set(live.id, {
        ...live,
        shot_data: { ...live.shot_data, camera: ELI_LOCK },
      });
    } else if (isObjectInsert(live.shot_data)) {
      app.store.shots.set(live.id, {
        ...live,
        shot_data: {
          ...live.shot_data,
          camera: objectPlateCamera(live.shot_data.function, live.shot_data.camera),
          speaker_on_camera: null,
        },
      });
    }
    const current = app.store.shots.get(live.id)!;
    const model = modelForShot(current);
    const seconds = Math.min(5, Math.max(4, current.shot_data.duration_hint_seconds));
    const nextCost = pricing.estimateVideo(model, seconds) + (current.shot_data.dialogue ? 0.01 : 0);
    if (current.shot_data.dialogue) {
      try {
        await app.generateDialogue({ owner_id: OWNER, shot_id: current.id });
        spend += 0.01;
      } catch (error) {
        process.stdout.write(`  tts skip ${index + 1}: ${error instanceof Error ? error.message : error}\n`);
      }
    }

    let reused: Uint8Array | null = null;
    const reuseSilent = isObjectInsert(current.shot_data) || !current.shot_data.dialogue;
    if (reuseSilent) {
      if (isObjectInsert(current.shot_data)) reused = await readPool(OBJECT_POOL, usedFiles);
      else if (/eli/i.test(current.shot_data.speaker_on_camera ?? "")) reused = await readPool(ELI_POOL, usedFiles);
    }
    if (reused) {
      const asset = await app.assets.put({
        id: `drama-long-take-${current.id}`,
        owner_id: OWNER,
        series_id: series.id,
        kind: "shot_video",
        bucket: "private-generation",
        storage_path: `private-generation/${series.id}/drama-long-take-${current.id}.mp4`,
        mime_type: "video/mp4",
        body: reused,
        checksum: `drama-long-take-${current.id}`,
        metadata: { shot_id: current.id, reused: true, function: current.shot_data.function },
        created_at: new Date().toISOString(),
      });
      app.store.shots.set(current.id, { ...current, status: "complete", selected_generation_id: asset.id });
      takes.push({ shot: app.store.shots.get(current.id)!, function: current.shot_data.function, model: "reused", reused: true, cut_eligible: true });
      process.stdout.write(`  reuse ${current.shot_data.function} b${current.shot_data.block_index} #${index + 1}\n`);
      continue;
    }

    if (spend + nextCost > SLICE_SOFT) {
      reused = /eli/i.test(current.shot_data.speaker_on_camera ?? current.shot_data.speaker ?? "")
        ? await readPool(ELI_POOL, usedFiles)
        : await readPool(MARA_CU_POOL, usedFiles);
      if (reused) {
        const asset = await app.assets.put({
          id: `drama-long-take-${current.id}`,
          owner_id: OWNER,
          series_id: series.id,
          kind: "shot_video",
          bucket: "private-generation",
          storage_path: `private-generation/${series.id}/drama-long-take-${current.id}.mp4`,
          mime_type: "video/mp4",
          body: reused,
          checksum: `drama-long-take-${current.id}`,
          metadata: { shot_id: current.id, reused: true, function: current.shot_data.function, soft_cap: true },
          created_at: new Date().toISOString(),
        });
        app.store.shots.set(current.id, { ...current, status: "complete", selected_generation_id: asset.id });
        takes.push({ shot: app.store.shots.get(current.id)!, function: current.shot_data.function, model: "reused", reused: true, cut_eligible: true });
        process.stdout.write(`  reuse-cap ${current.shot_data.function} #${index + 1}\n`);
        continue;
      }
      throw new Error("Slice soft cap with no reusable take left");
    }
    try {
      const { job } = await app.generateVideo({ owner_id: OWNER, shot_id: current.id, forceModel: model });
      process.stdout.write(`  gen ${current.shot_data.function} b${current.shot_data.block_index} #${index + 1} ${model} ${seconds}s\n`);
      let finished;
      try {
        finished = await poll(app, job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isCopyrightFailure(message)) throw error;
        const row = app.store.shots.get(current.id)!;
        app.store.shots.set(current.id, {
          ...row,
          shot_data: { ...row.shot_data, camera: copyrightSafeCamera(row), insert_plate_id: null },
        });
        const again = await app.generateVideo({
          owner_id: OWNER,
          shot_id: current.id,
          forceModel: isObjectInsert(row.shot_data) ? OBJECT_MODEL : CU_MODEL,
        });
        finished = await poll(app, again.job.id);
      }
      spend += finished.actual_cost ?? nextCost;
      const qc = (finished.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? [];
      const wanLockedCut = model.includes("wan") && qc.length === 1 && qc[0] === "internal_cut";
      if (!wanLockedCut && shouldRegenTake({ status: finished.status, reasons: qc, model })) {
        const again = await app.regenerateShot({ owner_id: OWNER, shot_id: current.id });
        finished = await poll(app, again.job.id);
        spend += finished.actual_cost ?? nextCost;
      }
      const assetId = String(finished.result_metadata.asset_id ?? "");
      const stored = assetId ? await app.assets.get(assetId) : null;
      takes.push({
        shot: app.store.shots.get(current.id) ?? current,
        function: current.shot_data.function,
        model,
        reused: false,
        status: finished.status,
        qc,
        cut_eligible: Boolean(stored) && cutEligible(qc),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  skip ${current.shot_data.function}: ${message}\n`);
      takes.push({ shot: current, function: current.shot_data.function, reused: false, cut_eligible: false, error: message });
    }
    if (spend + PRIOR_CUMULATIVE > SPEND_CAP) throw new Error("Hit the $150 OpenRouter cap");
  }

  const sliceComplete = slice.every((shot) => {
    const live = app.store.shots.get(shot.id);
    return Boolean(live?.selected_generation_id) && (live?.status === "complete" || live?.status === "needs_review");
  });
  if (!sliceComplete) throw new Error("Slice is not fully locked — refusing a holey cut");

  const rendered = await app.renderEpisode({
    owner_id: OWNER,
    episode_id: episode.id,
    block_indexes: SLICE_BLOCKS,
  });
  const finalBody = (await app.assets.get(rendered.asset.id))!.body;
  await writeFile(resolve(ROOT, `${ARTIFACT}-slice.mp4`), finalBody);
  if (rendered.vtt) await writeFile(resolve(ROOT, `${ARTIFACT}-captions.vtt`), rendered.vtt);
  const durationSeconds = probeVideoBytes(finalBody).duration_seconds;
  const report = {
    ran_at: new Date().toISOString(),
    sku: "900_1080",
    length_factor: 15,
    shot_budget: { min: 120, max: 200 },
    plan: {
      blocks: plan.outline?.blocks.length ?? plan.scenes.length,
      shots: shots.length,
      duration_hint_seconds: Number(sum.toFixed(1)),
      mid_reprice_index: plan.outline?.mid_reprice_index ?? null,
      lint_pass: lint.pass,
    },
    slice_blocks: SLICE_BLOCKS,
    slice_shots: slice.length,
    slice_path: `${ARTIFACT}-slice.mp4`,
    duration_seconds: Number(durationSeconds.toFixed(2)),
    container: rendered.container,
    identity_ref_policy: policy,
    cu_model: CU_MODEL,
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    reused_takes: takes.filter((row) => row.reused).length,
    generated_takes: takes.filter((row) => !row.reused).length,
    not_a_full_15_min_render: true,
    honest_note:
      "Tooling + a 2–4 min consecutive-block slice inside a 15-min plan. Full 15-min picture was not generated.",
    takes: takes.map(({ shot: _shot, ...rest }) => rest),
    how_to_run: "DRAMA_IDENTITY_REF_POLICY=face_only npm run test:live-long",
  };
  await writeFile(resolve(ROOT, `${ARTIFACT}-report.json`), JSON.stringify(report, null, 2));
  process.stdout.write(
    `Slice ${ARTIFACT}-slice.mp4 · ${durationSeconds.toFixed(1)}s · spend $${spend.toFixed(2)} · cumulative ~$${(PRIOR_CUMULATIVE + spend).toFixed(2)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
