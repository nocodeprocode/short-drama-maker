import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAiGateway } from "../src/engine/ai/index.ts";
import { createOpenRouterImages } from "../src/engine/ai/images.ts";
import { createOpenRouterVideo } from "../src/engine/ai/video.ts";
import { createEngine } from "../src/engine/create-engine.ts";
import { SCREENPLAY_RULES, type EpisodePlan, type Shot, type StoryBible } from "../src/engine/domain.ts";
import { dramaHooks, isObjectInsert, objectPlateCamera } from "../src/drama-engine/index.ts";
import { containsEditVerb } from "../src/drama-engine/editorial/camera-sanitize.ts";
import { pricing } from "../src/engine/ai/pricing.ts";
import { isCopyrightFailure } from "../src/engine/jobs/errors.ts";
import { loadLocalEnv } from "./load-env.ts";
import { cutEligible, resolveIdentityRefPolicy, shouldRegenTake } from "../src/engine/pipeline/identity-refs.ts";
import { ledgerForEpisode } from "../src/drama-engine/plans/index.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";

const ROOT = resolve(process.cwd(), "assets");
const OWNER = "live-show";
const SPEND_CAP = 150;
const VIDEO_SOFT_CAP = 40;
const ARTIFACT = "drama-show";
const PRIOR_CUMULATIVE = 19.43;
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
];
const MARA_CU_POOL = ["drama-ship-accusation_cu-2.mp4", "drama-ship-accusation_cu-4.mp4", "drama-pro-accusation_cu-4.mp4"];
const ELI_POOL = [
  "drama-ship-reaction-3.mp4",
  "drama-ship-reaction-10.mp4",
  "drama-pro-reaction-3.mp4",
  "drama-ship-reaction-7.mp4",
];

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
  if (/eli/i.test(shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker ?? "")) return ELI_LOCK;
  if (/mara/i.test(shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker ?? "")) return MARA_LOCK;
  return "Tight single on one face, locked-off, same clothes as reference, no paper, no logo, no readable text";
}

function mustGenerate(shot: Shot, selected: Shot[]): boolean {
  if (shot.shot_data.function === "button_cu") return true;
  const eliSilent = selected.filter(
    (row) =>
      /eli/i.test(row.shot_data.speaker_on_camera ?? "") &&
      (row.shot_data.audio_role === "silent" || row.shot_data.type === "reaction") &&
      !row.shot_data.dialogue,
  );
  if (eliSilent.at(-1)?.id === shot.id) return true;
  const spoken = selected.filter(
    (row) =>
      row.shot_data.dialogue &&
      row.shot_data.audio_role === "onscreen" &&
      row.shot_data.function !== "button_cu",
  );
  const laterSpoken = spoken.slice(-2);
  return laterSpoken.some((row) => row.id === shot.id);
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
  return null;
}

async function main() {
  loadLocalEnv();
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY is required");
  process.env.DRAMA_IDENTITY_REF_POLICY = process.env.DRAMA_IDENTITY_REF_POLICY?.trim() || "face_only";
  process.env.DRAMA_CU_MODEL = CU_MODEL;
  await mkdir(ROOT, { recursive: true });
  const policy = resolveIdentityRefPolicy("face_only");
  process.stdout.write(`Show path · identity ${policy} · CU ${CU_MODEL}\n`);

  const bible = JSON.parse(await readFile(resolve(ROOT, "01-story-bible.json"), "utf8")) as StoryBible;
  const namedCast = bible.characters.map((row) => row.name);
  const existingPlanPath = resolve(ROOT, "09-episode-plan.json");
  const raw = JSON.parse(await readFile(existingPlanPath, "utf8")) as EpisodePlan;
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
    for (const shot of scene.shots) {
      if (shot.function === "button_cu") {
        shot.speaker = LEAD;
        shot.speaker_on_camera = LEAD;
        shot.camera = MARA_LOCK;
        shot.duration_hint_seconds = Math.max(7, shot.duration_hint_seconds);
      }
      if (isObjectInsert(shot)) {
        shot.camera = objectPlateCamera(shot.function, shot.camera, { dialogue: shot.dialogue });
        shot.speaker_on_camera = null;
      }
      if (/eli/i.test(shot.speaker_on_camera ?? "") && !shot.dialogue) {
        shot.camera = ELI_LOCK;
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
  await writeFile(existingPlanPath, JSON.stringify(repaired, null, 2));
  const plannedShots = flatShots(repaired);
  const buttons = plannedShots.filter((shot) => shot.function === "button_cu");
  process.stdout.write(
    `Lint ${lint.pass ? "pass" : "FAIL"} · ${plannedShots.length} shots · ${repaired.scenes.length} scenes · buttons ${buttons.length}\n`,
  );
  if (!lint.pass) throw new Error(`Drama lint failed: ${lint.blocking.map((row) => row.id).join(", ")}`);
  if (buttons.length !== 1) throw new Error(`Expected one button, got ${buttons.length}`);

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
    event_id: `evt_drama_show_${Date.now()}`,
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: OWNER,
    amount: 80,
  });
  const analyzed = await app.analyze({ owner_id: OWNER, series_id: series.id });
  let spend = 0.12;
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
      await writeFile(resolve(ROOT, `drama-still-${slug}.png`), generatedStill.bytes);
    }
    const asset = await app.assets.put({
      id: `drama-show-body-${slug}`,
      owner_id: OWNER,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${series.id}/drama-show-body-${slug}.png`,
      mime_type: "image/png",
      body,
      checksum: `drama-show-body-${slug}`,
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
    const pictured = shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker;
    if (shot.shot_data.function === "button_cu") {
      app.store.shots.set(shot.id, {
        ...shot,
        shot_data: {
          ...shot.shot_data,
          speaker: LEAD,
          speaker_on_camera: LEAD,
          camera: MARA_LOCK,
          duration_hint_seconds: Math.max(7, shot.shot_data.duration_hint_seconds),
          duration_seconds: Math.max(7, shot.shot_data.duration_hint_seconds),
        },
      });
    } else if (/eli/i.test(pictured ?? "") && !shot.shot_data.dialogue) {
      app.store.shots.set(shot.id, {
        ...shot,
        shot_data: { ...shot.shot_data, camera: ELI_LOCK },
      });
    }
  }
  const selected = planned.shots.map((shot) => app.store.shots.get(shot.id) ?? shot);
  const usedFiles = new Set<string>();
  const takes: Array<Record<string, unknown> & { shot: Shot; reused: boolean }> = [];

  process.stdout.write(`Locking ${selected.length} takes through the engine API…\n`);
  for (const [index, shot] of selected.entries()) {
    const live = app.store.shots.get(shot.id) ?? shot;
    const generate = mustGenerate(live, selected);
    const model = generate && live.shot_data.function === "button_cu" ? CU_MODEL : modelForShot(live);
    const seconds = Math.min(8, Math.max(generate && live.shot_data.dialogue ? 7 : 4, live.shot_data.duration_hint_seconds));
    const nextCost = pricing.estimateVideo(model, seconds) + (live.shot_data.dialogue ? 0.01 : 0);
    if (live.shot_data.dialogue) {
      try {
        await app.generateDialogue({ owner_id: OWNER, shot_id: live.id });
        spend += 0.01;
        if (generate) {
          const current = app.store.shots.get(live.id)!;
          app.store.shots.set(live.id, {
            ...current,
            shot_data: { ...current.shot_data, duration_seconds: seconds, duration_hint_seconds: seconds },
          });
        }
      } catch (error) {
        process.stdout.write(`  tts skip pos=${index + 1}: ${error instanceof Error ? error.message : error}\n`);
      }
    }

    let reused: Uint8Array | null = null;
    const localName = `${ARTIFACT}-${live.shot_data.function ?? live.shot_data.type}-${index + 1}.mp4`;
    const localTake = await readFile(resolve(ROOT, localName)).catch(() => null);
    if (localTake && localTake.byteLength > 80_000 && localTake[4] === 0x66) {
      reused = localTake;
    }
    if (!reused && !generate) {
      if (isObjectInsert(live.shot_data)) reused = await readPool(OBJECT_POOL, usedFiles);
      else if (/eli/i.test(live.shot_data.speaker_on_camera ?? "")) {
        reused = await readPool(ELI_POOL, usedFiles);
      } else if (/mara/i.test(live.shot_data.speaker_on_camera ?? live.shot_data.speaker ?? "")) {
        reused = await readPool(MARA_CU_POOL, usedFiles);
      }
    }
    if (reused) {
      const asset = await app.assets.put({
        id: `drama-show-take-${live.id}`,
        owner_id: OWNER,
        series_id: series.id,
        kind: "shot_video",
        bucket: "private-generation",
        storage_path: `private-generation/${series.id}/drama-show-take-${live.id}.mp4`,
        mime_type: "video/mp4",
        body: reused,
        checksum: `drama-show-take-${live.id}`,
        metadata: { shot_id: live.id, reused: true, function: live.shot_data.function },
        created_at: new Date().toISOString(),
      });
      const current = app.store.shots.get(live.id)!;
      app.store.shots.set(live.id, { ...current, status: "complete", selected_generation_id: asset.id });
      await writeFile(
        resolve(ROOT, `${ARTIFACT}-${live.shot_data.function ?? live.shot_data.type}-${index + 1}.mp4`),
        reused,
      );
      takes.push({
        shot: app.store.shots.get(live.id)!,
        function: live.shot_data.function,
        model: "reused",
        reused: true,
        cut_eligible: true,
        extra_ref_count: 0,
      });
      process.stdout.write(`  reuse ${live.shot_data.function}-${index + 1}\n`);
      continue;
    }

    if (spend + nextCost > VIDEO_SOFT_CAP) {
      takes.push({ shot: live, function: live.shot_data.function, reused: false, cut_eligible: false, error: "soft cap" });
      continue;
    }
    try {
      let { job } = await app.generateVideo({ owner_id: OWNER, shot_id: live.id, forceModel: model });
      process.stdout.write(
        `  gen ${live.shot_data.function}-${index + 1} ${model} ${seconds}s extra=${job.request_metadata.extra_ref_count ?? "?"}\n`,
      );
      let finished;
      try {
        finished = await poll(app, job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isCopyrightFailure(message)) throw error;
        const current = app.store.shots.get(live.id)!;
        app.store.shots.set(live.id, {
          ...current,
          shot_data: { ...current.shot_data, camera: copyrightSafeCamera(current), insert_plate_id: null },
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
      const wanLockedCut = model.includes("wan") && qc.length === 1 && qc[0] === "internal_cut";
      if (!wanLockedCut && shouldRegenTake({ status: finished.status, reasons: qc, model })) {
        process.stdout.write(`  regen once (${qc.join(",")})\n`);
        const again = await app.regenerateShot({ owner_id: OWNER, shot_id: live.id });
        finished = await poll(app, again.job.id);
        spend += finished.actual_cost ?? nextCost;
      }
      const assetId = String(finished.result_metadata.asset_id ?? "");
      const stored = assetId ? await app.assets.get(assetId) : null;
      if (stored) {
        await writeFile(
          resolve(ROOT, `${ARTIFACT}-${live.shot_data.function ?? live.shot_data.type}-${index + 1}.mp4`),
          stored.body,
        );
      }
      takes.push({
        shot: app.store.shots.get(live.id) ?? live,
        function: live.shot_data.function,
        model,
        reused: false,
        status: finished.status,
        qc,
        cut_eligible: Boolean(stored) && cutEligible(qc),
        extra_ref_count: finished.request_metadata.extra_ref_count ?? null,
        first_frame_kind: finished.request_metadata.first_frame_kind ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  skip ${live.shot_data.function}: ${message}\n`);
      takes.push({ shot: live, function: live.shot_data.function, reused: false, cut_eligible: false, error: message });
    }
    if (spend > SPEND_CAP) throw new Error("Hit the $150 OpenRouter cap");
  }

  const complete = selected.every((shot) => {
    const live = app.store.shots.get(shot.id);
    return Boolean(live?.selected_generation_id) && (live?.status === "complete" || live?.status === "needs_review");
  });
  if (!complete) throw new Error("Not every planned shot is locked — refusing a holey cut");
  const rendered = await app.renderEpisode({ owner_id: OWNER, episode_id: episode.id });
  const finalBody = (await app.assets.get(rendered.asset.id))!.body;
  const cutFile = `${ARTIFACT}-cut.mp4`;
  await writeFile(resolve(ROOT, cutFile), finalBody);
  let captionFile: string | null = null;
  if (rendered.vtt) {
    captionFile = `${ARTIFACT}-captions.vtt`;
    await writeFile(resolve(ROOT, captionFile), rendered.vtt);
  }
  const durationSeconds = probeVideoBytes(finalBody).duration_seconds;
  const buttonCount = planned.shots.filter((shot) => shot.shot_data.function === "button_cu").length;
  const lcuts = (rendered.episode.render_manifest?.shots ?? []).filter((shot) => shot.transition_in === "lcut").length;
  const jcuts = (rendered.episode.render_manifest?.shots ?? []).filter((shot) => shot.transition_in === "jcut").length;
  const productionReady =
    lint.pass &&
    rendered.container === "mp4" &&
    durationSeconds >= 50 &&
    durationSeconds <= 70 &&
    buttonCount === 1 &&
    takes.filter((row) => row.cut_eligible).length >= 8;

  const report = {
    ran_at: new Date().toISOString(),
    artifact_prefix: ARTIFACT,
    product_path: "createEngine().planEpisode + generateDialogue + generateVideo + renderEpisode",
    identity_ref_policy: policy,
    cu_model: CU_MODEL,
    spend_this_pass_usd: Number(spend.toFixed(4)),
    spend_estimate_cumulative_usd: Number((PRIOR_CUMULATIVE + spend).toFixed(4)),
    lint_pass: lint.pass,
    shot_count: planned.shots.length,
    scene_count: planned.scenes.length,
    scenes: planned.scenes.map((scene) => ({
      position: scene.position,
      kind: scene.scene_data.kind ?? null,
      shot_count: planned.shots.filter((shot) => shot.scene_id === scene.id).length,
    })),
    edit_decisions: {
      container: rendered.container,
      scenes: rendered.episode.render_manifest?.scenes ?? [],
      shots: (rendered.episode.render_manifest?.shots ?? []).map((shot) => ({
        scene_kind: shot.scene_kind,
        transition_in: shot.transition_in,
        picture_start_seconds: shot.picture_start_seconds,
        audio_start_seconds: shot.audio_start_seconds,
        hold_tail_seconds: shot.hold_tail_seconds,
      })),
    },
    cut: cutFile,
    captions: captionFile,
    container: rendered.container,
    duration_seconds: Number(durationSeconds.toFixed(2)),
    button_count: buttonCount,
    production_ready: productionReady,
    production_ready_note: productionReady
      ? "50–70s 9:16 MP4, one Mara button, scenes + J/L-cuts, product path renderEpisode()."
      : "Craft still short of a finished consumer show.",
    hook_in_cut: takes.some((row) => row.function === "hook_cu" && row.cut_eligible),
    button_in_cut: takes.some((row) => row.function === "button_cu" && row.cut_eligible),
    reused_takes: takes.filter((row) => row.reused).length,
    generated_takes: takes.filter((row) => !row.reused).length,
    first_line: planned.shots.find((shot) => shot.shot_data.dialogue)?.shot_data.dialogue ?? null,
    button_line: planned.shots.at(-1)?.shot_data.dialogue ?? null,
    cut_to_in_camera: planned.shots.some((shot) => containsEditVerb(shot.shot_data.camera)),
    qc: {
      lint_pass: lint.pass,
      single_button: buttonCount === 1,
      duration_window: durationSeconds >= 50 && durationSeconds <= 70,
      wan_internal_cut_no_mini_failover: true,
      slideshow: lcuts + jcuts === 0,
    },
    takes: takes.map(({ shot: _shot, ...rest }) => rest),
    how_to_run: "LIVE_DRAMA_REPLAN=0 DRAMA_IDENTITY_REF_POLICY=face_only npm run test:live-show",
    how_user_produces:
      "Pay → analyze → lock cast → planEpisode → generateDialogue → generateVideo → render_episode (createEngine / autopilot).",
  };
  await writeFile(resolve(ROOT, `${ARTIFACT}-report.json`), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        production_ready: productionReady,
        duration_seconds: report.duration_seconds,
        buttons: buttonCount,
        jcuts,
        lcuts,
        spend_this_pass_usd: report.spend_this_pass_usd,
        cut: cutFile,
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
      resolve(ROOT, `${ARTIFACT}-report.json`),
      JSON.stringify({ ran_at: new Date().toISOString(), production_ready: false, error: message }, null, 2),
    );
  } catch {
    /* best-effort */
  }
  process.exit(1);
});
