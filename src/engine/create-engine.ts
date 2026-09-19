import { createAiGateway, type AIGateway } from "./ai/index.ts";
import { ContentBlockedError } from "./ai/moderation.ts";
import { assertStandardOnly } from "./ai/privacy.ts";
import { generationPrivacyLog } from "../legal/providers.ts";
import {
  DEFAULT_DAILY_SPEND_CAP,
  DIALOGUE_DURATION_WINDOW,
  QC_AUTOPILOT_DURATION_TOLERANCE_SECONDS,
  RETRY_CAP,
  SIGNED_URL_TTL_SECONDS,
  TEXT_MODEL,
  VIDEO_PENDING_MAX_SECONDS,
  VIDEO_ROUTES,
} from "./config/models.ts";
import { decodeJson, encodeJson, sha256Hex, sha256HexSync, stableStringify } from "./crypto.ts";
import { concatMp4Segments, concatWavSegments, mergeManifests, mergeVtt, normalizeProgrammeLoudness } from "./media/concat.ts";
import { LOUDNESS } from "../drama-engine/types/audio.ts";
import { CONFORM_MAX_PASSES, conformCorrections, onlyConformable } from "./pipeline/sync-conform.ts";
import { cuesFromVtt, cuesToSrt } from "./pipeline/captions.ts";
import { manifestFingerprint } from "./media/render.ts";
import { reframeMp4, type DeliverableAspect } from "./media/reframe.ts";
import { plateMoveFor, plateTake } from "./media/plate-take.ts";
import type { NormalizedFaceBox } from "./media/viseme-align.ts";
import { sameName } from "../drama-engine/editorial/camera-sanitize.ts";
import { estimateSeries as estimateSeriesCost, type CatalogSku } from "./config/skus.ts";
import { episodeLengthFromProfile, type EpisodeLength } from "./config/catalog.ts";
import { dramaHooks } from "../drama-engine/index.ts";
import { defaultCraftForShot } from "../drama-engine/editorial/shot-budget.ts";
import { allowsTwoShot, expectedFacesFor, isObjectInsert, isSceneTake, sceneTakeIndexOf, spokenTakeNeedsMeasure } from "../drama-engine/types/editorial.ts";
import type {
  Actor,
  ActorSource,
  AlignmentTrack,
  AppearanceProfile,
  Character,
  Episode,
  EpisodePlan,
  GenerationJob,
  LedgerEntry,
  ModerationCheckpoint,
  PrivacyProfile,
  QualityProfile,
  RenderManifest,
  SeasonSku,
  Series,
  Shot,
  ShotData,
  StoryBible,
  VisualReferenceKind,
  VoiceCandidate,
} from "./domain.ts";
import { extractAudioMp3 } from "./media/extract-audio.ts";
import { alignVoicePrompt } from "./ai/voice-sex.ts";
import { sceneTakesShareSpokenBeat } from "../drama-engine/types/dialogue.ts";
import { acceptPolishedTalk, keepPlanAfterPolishFailure } from "../drama-engine/types/talk.ts";
import { expectedSpokenText, shouldSampleDialogueStt } from "./pipeline/stt-qc.ts";
import { nameLeakReasons } from "./pipeline/seedance-qc.ts";
import { isPrivacyRefusal, screenCastLook } from "./pipeline/face-screen.ts";
import { stillRetryNote } from "./pipeline/still-retry.ts";
import { addSeconds, cryptoIds, iso, systemClock, type Clock, type IdFactory } from "./ids.ts";
import { isInputImagePrivacyFailure, redactTaskError } from "./jobs/errors.ts";
import { locationRefForScene, pinLocationToBible } from "./pipeline/location-ref.ts";
import {
  FACE_KIND_ORDER,
  appearanceDescription,
  lookPrompt,
  looksFromBible,
  preferredCuFace,
  preferredFaceId,
  seedStillForCu,
  wardrobeForScene,
} from "./pipeline/wardrobe.ts";
import { cropStillToCu, CU_CROP_VERSION, firstFrameKind, firstFrameQc } from "./media/face-crop.ts";
import { identityDrifted, meanRgb } from "./media/identity-drift.ts";
import { analyzeTake, pickBestTake, scoreTake, type TakeAnalysis, type TakeVerdict } from "./pipeline/take-analysis.ts";
import { runIdentityStage, shrinkReference, sampleJpegFrames } from "./pipeline/identity-check.ts";
import {
  BLOCKING_STILL_IDENTITY_MIN,
  BLOCKING_STILL_KIND,
  BLOCKING_STILL_MODE,
  blockingFramingFor,
  blockingStillKey,
  selectShotRefs,
  shouldUseBlockingStill,
} from "./pipeline/blocking-still.ts";
import { stampCharacterSheet, type SheetRole, type SheetStrength } from "./pipeline/character-sheet.ts";
import {
  applySceneTakeStrip,
  buildSceneTakeRefs,
  SCENE_TAKE_PRIVACY_STRIPS,
  sheetStrengthFor,
  stripRank,
  strongestStrip,
  type SceneTakeLock,
  type SceneTakeStrip,
} from "./pipeline/scene-take-refs.ts";
import { publicLog } from "./logging.ts";
import {
  documentFromMeta,
  documentPrompt,
  documentTypeset,
  fallbackDocument,
  inferPropKind,
  isReadableDocument,
  normalizeWrittenDocument,
  OBJECT_ANGLE_KIND,
  objectLettering,
  objectViews,
  PROP_BIBLE_KINDS,
  PROP_KIND,
  PROP_PROMPTS,
  propFromLockText,
  propKey,
  type PropKind,
  type WrittenDocument,
} from "./pipeline/prop-bible.ts";
import { LAST_FRAME_KIND, previousContinuityShot, previousSceneTake } from "./pipeline/last-frame.ts";
import { wordErrorRate } from "./media/qc.ts";
import { placeLettering, placeLockClause, placePlateRetry, ROOM_PACK_VERSION, roomAnglesFor } from "../drama-engine/craft/place.ts";
import { expandPlaceName } from "./design/slate.ts";
import { evidenceMotif, identityLockLine, objectPlateCamera, peopleOnSceneTake, sameSpeakerCast, sceneTakeImageLocks, speakersForSceneTake } from "../drama-engine/craft/prompt-fragments.ts";
import { dropOpeningEcho } from "../drama-engine/types/dialogue.ts";
import { cueRows, cueText, exitsIn } from "../drama-engine/types/continuity.ts";
import { playbookFor } from "../drama-engine/craft/genre-playbooks.ts";
import { videoContextBlock } from "../drama-engine/craft/video-context.ts";
import { lastFramingOf } from "../drama-engine/craft/shot-list.ts";
import { humanMotifs } from "../drama-engine/types/where.ts";
import { assertSeasonBible, buildSeasonBible, isLongFormLength, ledgerForEpisode, planLongFormEpisode } from "../drama-engine/plans/index.ts";
import { failoverRoute } from "./ai/router.ts";
import {
  orderIdentityRefs,
  resolveIdentityRefPolicy,
  shouldFailoverModel,
  type IdentityRefPolicy,
} from "./pipeline/identity-refs.ts";
import { isActive, isTerminal, transitionJob } from "./jobs/state-machine.ts";
import { isBusyVideoJob } from "./jobs/queue-policy.ts";
import {
  assertCanReserve,
  DEFAULT_PRICE_SNAPSHOT_VERSION,
  DuplicateStripeEventError,
  hasLedgerPair,
  hasStripeEvent,
  projectBalance,
  reservedForJob,
} from "./ledger/budget.ts";
import { chooseHeardLane } from "./pipeline/heard-audio.ts";
import { blockingQcReasons, mechanicalQc } from "./media/qc.ts";
import { probeVideoBytes, probeVideoBytesAsync } from "./media/probe.ts";
import { RenderFailedError, renderEpisodeBytes, type RenderFn } from "./media/render.ts";
import { auditMux, type MuxAuditFn } from "./media/mux-audit.ts";
import { createConfiguredAssetStore } from "./storage/create.ts";
import { assetPath, extForMime } from "./storage/paths.ts";
import { planRetention } from "./storage/retention.ts";
import type { AssetStore } from "./storage/types.ts";
import { MemoryStore } from "./store.ts";
import { transcriptFromAlignment } from "./media/qc.ts";

export type EngineDeps = {
  store?: MemoryStore;
  assets?: AssetStore;
  ai?: AIGateway;
  clock?: Clock;
  ids?: IdFactory;
  dailyCap?: number;
  skipSeriesBudget?: boolean;
  identityRefPolicy?: IdentityRefPolicy;
  /** Override the mixer (tests, remote media worker). Defaults to the local ffmpeg path. */
  render?: RenderFn;
  /** Override the post-mux audit gate (tests). Defaults to the ffmpeg frame audit. */
  audit?: MuxAuditFn;
  /** Spend another attempt immediately when a take is dropped at ingest. Default true. */
  autoRegenerate?: boolean;
  /** Override the per-take measurement (tests). Defaults to the ffmpeg take analysis. */
  analyze?: typeof analyzeTake;
  /** Override the aspect re-framer (tests). Defaults to the ffmpeg re-frame. */
  reframe?: typeof reframeMp4;
  /** Override block concatenation (tests). Defaults to an ffmpeg stream-copy concat. */
  concat?: typeof concatMp4Segments;
  /** Override the plate-to-take synthesiser (tests). Defaults to ffmpeg zoompan. */
  plateTake?: typeof plateTake;
  /** Episodes with at least this many takes render per block. */
  blockRenderMinShots?: number;
};

export type StripeWebhookInput = {
  event_id: string;
  signature_valid: boolean;
  type: string;
  payment_status?: "paid" | "unpaid" | "no_payment_required";
  series_id: string;
  owner_id: string;
  amount: number;
};

export type OpenRouterWebhookInput = {
  callback_token: string;
  upstream_job_id?: string;
};

/**
 * Callback URL registered with OpenRouter. Returns null when no webhook base is
 * configured; the runner's tick/reconcile sweep then polls instead. The shared
 * secret rides in the URL because OpenRouter does not sign callbacks.
 */
function openRouterCallbackUrl(token: string): string | null {
  const explicit = process.env.OPENROUTER_WEBHOOK_URL?.trim().replace(/\/$/, "");
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim().replace(/\/$/, "");
  const base = explicit || (supabaseUrl ? `${supabaseUrl}/functions/v1/webhooks-openrouter` : null);
  if (!base) return null;
  const secret = process.env.OPENROUTER_WEBHOOK_SECRET?.trim();
  const params = new URLSearchParams({ token });
  if (secret) params.set("secret", secret);
  return `${base}?${params.toString()}`;
}

export class RenderIncompleteError extends Error {
  constructor(readonly missing: string[]) {
    super(`Not every shot is complete: ${missing.join("; ")}`);
    this.name = "RenderIncompleteError";
  }
}

export class DuplicateSceneTakeError extends Error {
  constructor(readonly shotId: string, readonly alreadyShotId: string) {
    super(
      `Duplicate scene take: ${shotId} restates ${alreadyShotId}. Not submitting a second video job.`,
    );
    this.name = "DuplicateSceneTakeError";
  }
}

/** Below this many takes an episode renders in one pass; above it, per block with reuse. */
export const BLOCK_RENDER_MIN_SHOTS = 24;
/** Bump when the mixer's output for the same inputs changes, so cached blocks re-render. */
export const MIXER_VERSION = 4;
/** Image attempts for an empty location plate before the lock fails loudly. */
export const LOCATION_PLATE_ATTEMPTS = 4;

function emptyAppearance(): AppearanceProfile {
  return { age_look: "", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" };
}

function speakersOnShot(shot: Shot): string[] {
  return peopleOnSceneTake({
    sceneScript: shot.shot_data.scene_script,
    speaker: shot.shot_data.speaker,
    speakerOnCamera: shot.shot_data.speaker_on_camera,
    blocking: shot.shot_data.blocking,
  });
}

export function createEngine(deps: EngineDeps = {}) {
  const store = deps.store ?? new MemoryStore();
  const assets = deps.assets ?? createConfiguredAssetStore();
  const ai = deps.ai ?? createAiGateway();
  const identityRefPolicy = resolveIdentityRefPolicy(deps.identityRefPolicy);
  const render = deps.render ?? renderEpisodeBytes;
  const audit = deps.audit ?? auditMux;
  const autoRegenerate = deps.autoRegenerate ?? true;
  const measureTake = deps.analyze ?? analyzeTake;
  const reframe = deps.reframe ?? reframeMp4;
  const concat = deps.concat ?? concatMp4Segments;
  const plateFn = deps.plateTake ?? plateTake;
  const blockRenderMinShots = deps.blockRenderMinShots ?? BLOCK_RENDER_MIN_SHOTS;
  const clock = deps.clock ?? systemClock();
  const ids = deps.ids ?? cryptoIds();
  store.dailyCap = deps.dailyCap ?? DEFAULT_DAILY_SPEND_CAP;
  const skipSeriesBudget = deps.skipSeriesBudget === true;
  const pendingVoices = new Map<string, VoiceCandidate[]>();

  function requireSeries(seriesId: string, ownerId: string): Series {
    const series = store.series.get(seriesId);
    if (!series || series.owner_id !== ownerId || series.deleted_at) {
      throw new Error("Series not found");
    }
    return series;
  }

  function requireCharacter(characterId: string, ownerId: string): Character {
    const character = store.characters.get(characterId);
    if (!character) throw new Error("Character not found");
    requireSeries(character.series_id, ownerId);
    return character;
  }

  function requireShot(shotId: string, ownerId: string): { shot: Shot; series: Series; episode: Episode } {
    const shot = store.shots.get(shotId);
    if (!shot) throw new Error("Shot not found");
    const scene = store.scenes.get(shot.scene_id);
    if (!scene) throw new Error("Scene not found");
    const episode = store.episodes.get(scene.episode_id);
    if (!episode) throw new Error("Episode not found");
    const series = requireSeries(episode.series_id, ownerId);
    return { shot, series, episode };
  }

  function writeLedger(entry: Omit<LedgerEntry, "id" | "created_at">): LedgerEntry {
    const row: LedgerEntry = {
      ...entry,
      id: ids.id(),
      created_at: iso(clock),
    };
    store.ledger.push(row);
    return row;
  }

  async function putAsset(input: {
    owner_id: string;
    series_id: string | null;
    actor_id?: string | null;
    kind: Parameters<AssetStore["put"]>[0]["kind"];
    bucket: Parameters<AssetStore["put"]>[0]["bucket"];
    mime_type: string;
    body: Uint8Array;
    metadata?: Record<string, unknown>;
  }) {
    const id = ids.id();
    const ext = extForMime(input.mime_type);
    return assets.put({
      id,
      owner_id: input.owner_id,
      series_id: input.series_id,
      actor_id: input.actor_id ?? null,
      kind: input.kind,
      bucket: input.bucket,
      storage_path: assetPath({
        bucket: input.bucket,
        seriesId: input.series_id,
        kind: input.kind,
        id,
        ext,
        ownerId: input.owner_id,
        actorId: input.actor_id ?? undefined,
      }),
      mime_type: input.mime_type,
      body: input.body,
      checksum: await sha256Hex(input.body),
      metadata: input.metadata ?? {},
      created_at: iso(clock),
    });
  }

  function faceRefsFor(character: Character): Partial<Record<VisualReferenceKind, string>> {
    const actor = character.actor_id ? store.actors.get(character.actor_id) : undefined;
    return { ...(actor?.visual_reference_asset_ids ?? {}), ...character.visual_reference_asset_ids };
  }

  function ensureActorForCharacter(character: Character, ownerId: string): Actor {
    if (character.actor_id) {
      const existing = store.actors.get(character.actor_id);
      if (existing) return existing;
    }
    const actor: Actor = {
      id: ids.id(),
      owner_id: ownerId,
      name: character.name,
      source: "generated",
      seed_asset_id: null,
      appearance_profile: character.appearance_profile,
      visual_reference_asset_ids: { ...character.visual_reference_asset_ids },
      identity_fidelity: "faithful",
      judge_notes: null,
      created_at: iso(clock),
      updated_at: iso(clock),
    };
    store.actors.set(actor.id, actor);
    store.characters.set(character.id, { ...character, actor_id: actor.id, updated_at: iso(clock) });
    return actor;
  }

  function findJobByKey(key: string): GenerationJob | undefined {
    return [...store.jobs.values()].find((job) => job.idempotency_key === key);
  }

  /**
   * The base key when no job holds it or the holder is still in flight (a
   * crashed task replays it); a numbered key when the holder already finished,
   * so redoing finished work is a new job with its own ledger lines.
   */
  function freshJobKey(base: string): string {
    const holders = [...store.jobs.values()].filter((job) => job.idempotency_key === base || job.idempotency_key.startsWith(`${base}:r`));
    if (!holders.length) return base;
    const inFlight = holders.find((job) => job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled");
    if (inFlight) return inFlight.idempotency_key;
    return `${base}:r${holders.length}`;
  }

  function createJob(input: Omit<GenerationJob, "id" | "created_at" | "updated_at" | "callback_token" | "callback_token_used" | "attempt" | "actual_cost" | "error_code" | "result_metadata"> & Partial<Pick<GenerationJob, "result_metadata" | "attempt">>): GenerationJob {
    const existing = findJobByKey(input.idempotency_key);
    if (existing) {
      if (existing.status === "completed") return existing;
      if (existing.job_type !== "video") {
        const retried: GenerationJob = {
          ...existing,
          status: "queued",
          attempt: existing.attempt + 1,
          error_code: null,
          updated_at: iso(clock),
        };
        store.jobs.set(retried.id, retried);
        return retried;
      }
      return existing;
    }
    const job: GenerationJob = {
      ...input,
      id: ids.id(),
      callback_token: ids.token(),
      callback_token_used: false,
      attempt: input.attempt ?? 1,
      actual_cost: null,
      error_code: null,
      result_metadata: input.result_metadata ?? {},
      created_at: iso(clock),
      updated_at: iso(clock),
    };
    store.jobs.set(job.id, job);
    store.queue.push({
      id: ids.id(),
      job_id: job.id,
      kind: job.job_type === "video" ? "generate" : "generate",
      created_at: iso(clock),
      visible_at: iso(clock),
    });
    return job;
  }

  async function moderate(content: string, checkpoint: ModerationCheckpoint, seriesId: string | null, jobId: string | null) {
    const verdict = await ai.moderation.check(content, checkpoint);
    store.moderation.push({
      id: ids.id(),
      job_id: jobId,
      series_id: seriesId,
      checkpoint,
      verdict: verdict.verdict,
      category: verdict.category,
      reason: verdict.reason,
      created_at: iso(clock),
    });
    if (verdict.verdict === "block") {
      throw new ContentBlockedError(verdict);
    }
    return verdict;
  }

  function reserve(job: GenerationJob) {
    // A task that failed after reserving and was persisted keeps its hold; the
    // retry reuses the job and must not reserve twice (or be refused for it).
    if (hasLedgerPair(store.ledger, job.id, "reserve") && !hasLedgerPair(store.ledger, job.id, "release") && !hasLedgerPair(store.ledger, job.id, "settle")) {
      ai.meter.take();
      return;
    }
    assertCanReserve(
      store.ledger.filter((row) => row.series_id === job.series_id),
      job.id,
      job.estimated_cost,
      store.dailySpend,
      store.dailyCap,
      { skipSeriesBudget },
    );
    writeLedger({
      owner_id: job.owner_id,
      series_id: job.series_id,
      entry_type: "reserve",
      amount: job.estimated_cost,
      generation_job_id: job.id,
      stripe_event_id: null,
      price_snapshot_version: store.priceSnapshotVersion,
    });
    store.dailySpend += job.estimated_cost;
    // Anything metered before this point belongs to an earlier job.
    ai.meter.take();
  }

  function settle(job: GenerationJob, actual: number) {
    if (hasLedgerPair(store.ledger, job.id, "settle")) return;
    const reserved = reservedForJob(store.ledger, job.id);
    writeLedger({
      owner_id: job.owner_id,
      series_id: job.series_id,
      entry_type: "settle",
      amount: actual,
      generation_job_id: job.id,
      stripe_event_id: null,
      price_snapshot_version: store.priceSnapshotVersion,
    });
    // Unwind the whole hold; the settle row above is the only debit that stays.
    if (reserved > 1e-9) {
      writeLedger({
        owner_id: job.owner_id,
        series_id: job.series_id,
        entry_type: "release",
        amount: reserved,
        generation_job_id: job.id,
        stripe_event_id: null,
        price_snapshot_version: store.priceSnapshotVersion,
      });
    }
    store.dailySpend += actual - reserved;
  }

  function characterBySpeaker(seriesId: string, speaker: string): Character {
    const needle = speaker.trim().toLowerCase();
    const match = store.charactersFor(seriesId).find((character) => {
      return (
        character.name.toLowerCase() === needle ||
        character.name.toLowerCase().split(/\s+/)[0] === needle
      );
    });
    if (!match) throw new Error(`No locked character named ${speaker}`);
    return match;
  }

  /**
   * Modesty baseline for the pictured character: the locked CU still, which was
   * generated under the modest-dress rules. Null when the shot has no face.
   */
  async function modestStillForShot(shot: Shot): Promise<string | null> {
    const name = shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker;
    if (!name) return null;
    const scene = store.scenes.get(shot.scene_id);
    const episode = scene ? store.episodes.get(scene.episode_id) : undefined;
    if (!episode) return null;
    try {
      const character = characterBySpeaker(episode.series_id, name);
      return character.visual_reference_asset_ids.cu ?? preferredFaceId(character.visual_reference_asset_ids) ?? null;
    } catch {
      return null;
    }
  }

  async function createSeries(input: {
    owner_id: string;
    title: string;
    description: string;
    target_episode_count?: SeasonSku;
    sku?: CatalogSku;
  }) {
    const series: Series = {
      id: ids.id(),
      owner_id: input.owner_id,
      title: input.title,
      description: input.description,
      style_profile: { aspect: "9:16", episode_length: "60_90" },
      story_bible: null,
      target_episode_count: input.target_episode_count ?? null,
      sku: input.sku != null ? String(input.sku) : input.target_episode_count ? String(input.target_episode_count) : null,
      location_refs: {},
      cover_asset_id: null,
      status: "draft",
      deleted_at: null,
      created_at: iso(clock),
    };
    store.series.set(series.id, series);
    return series;
  }

  async function analyze(input: {
    owner_id: string;
    series_id: string;
    /** Parts the buyer cast before the story existed. */
    required_cast?: ReadonlyArray<{
      name: string;
      note?: string;
      actor_id?: string | null;
      job?: "engine" | "wall" | "witness" | "nuke";
    }>;
    /** Rooms the buyer approved, whose plates already exist. */
    required_locations?: ReadonlyArray<string>;
  }) {
    const series = requireSeries(input.series_id, input.owner_id);
    await moderate(`${series.title}\n${series.description}`, "story_input", series.id, null);
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "story_analysis",
      model: TEXT_MODEL,
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: `analyze:${series.id}`,
      status: "queued",
      request_metadata: {},
      estimated_cost: ai.pricing.estimateLlm(),
      expected_ready_at: addSeconds(clock, 5),
    });
    reserve(job);
    const cast = (input.required_cast ?? []).filter((row) => row.name.trim());
    const bible = await ai.llm.analyzeStory({
      title: series.title,
      idea: series.description,
      required_cast: cast.map((row) => ({ name: row.name, note: row.note, job: row.job })),
      required_locations: (input.required_locations ?? []).map((row) => row.trim()).filter(Boolean),
    });
    if (!bible.season) bible.season = buildSeasonBible(bible);
    bible.season = assertSeasonBible(bible.season);
    if (bible.characters.length < 3 || bible.characters.length > 8) {
      throw new Error("Story bible needs 3–8 named roles (Engine / Wall / Witness / Nuke)");
    }
    await moderate(
      [
        bible.title,
        bible.logline,
        ...bible.characters.map(
          (character) =>
            `${character.name}\n${character.description}\n${character.voice_design_prompt}`,
        ),
      ].join("\n"),
      "story_input",
      series.id,
      job.id,
    );
    // A part the buyer cast keeps its face: the character is born pointing at
    // that actor, so the prep pipeline never generates a stranger for it.
    const ownedActor = (id: string | null | undefined) =>
      id && store.actors.get(id)?.owner_id === input.owner_id ? String(id) : null;
    const castByName = new Map(
      cast.flatMap((row) => {
        const actorId = ownedActor(row.actor_id);
        return actorId ? [[row.name.trim().toLowerCase(), actorId] as const] : [];
      }),
    );
    const usedActors = new Set<string>();
    const castByJob = new Map(
      cast.flatMap((row) => {
        const actorId = ownedActor(row.actor_id);
        return actorId && row.job ? [[row.job, actorId] as const] : [];
      }),
    );
    for (const draft of bible.characters) {
      const byName = castByName.get(draft.name.trim().toLowerCase()) ?? null;
      const job = typeof draft.personality?.job === "string" ? String(draft.personality.job) : "";
      const byJob = !byName && job ? (castByJob.get(job as "engine" | "wall" | "witness" | "nuke") ?? null) : null;
      const chosen = (byName && !usedActors.has(byName) ? byName : null) ?? (byJob && !usedActors.has(byJob) ? byJob : null);
      if (chosen) usedActors.add(chosen);
      const chosenActor = chosen ? store.actors.get(chosen) : undefined;
      const character: Character = {
        id: ids.id(),
        series_id: series.id,
        name: draft.name,
        description: draft.description,
        actor_id: chosenActor?.id ?? null,
        appearance_profile: draft.appearance,
        visual_reference_asset_ids: { ...(chosenActor?.visual_reference_asset_ids ?? {}) },
        wardrobe_asset_ids: {},
        voice_profile: {
          design_prompt: alignVoicePrompt(draft.voice_design_prompt, `${draft.name}. ${draft.description}`),
          elevenlabs_voice_id: null,
          canonical_reference_asset_id: null,
          accent: "american",
          age_profile: draft.appearance.age_look,
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 0,
          locked: false,
        },
        personality_profile: draft.personality,
        relationships: draft.relationships,
        default_wardrobe: draft.appearance.default_wardrobe,
        locked: false,
        created_at: iso(clock),
        updated_at: iso(clock),
      };
      store.characters.set(character.id, character);
    }
    store.jobs.set(job.id, transitionJob(job, "submitting", iso(clock)));
    const generating = transitionJob(store.jobs.get(job.id)!, "generating", iso(clock));
    store.jobs.set(job.id, generating);
    const ingesting = transitionJob(generating, "ingesting", iso(clock));
    store.jobs.set(job.id, ingesting);
    const qc = transitionJob(ingesting, "qc", iso(clock));
    store.jobs.set(job.id, qc);
    const { actual, breakdown } = meteredActual(job.estimated_cost);
    store.jobs.set(
      job.id,
      transitionJob(qc, "completed", iso(clock), {
        actual_cost: actual,
        result_metadata: breakdown ? { ...qc.result_metadata, cost_breakdown: breakdown } : qc.result_metadata,
      }),
    );
    settle(store.jobs.get(job.id)!, actual);
    store.series.set(series.id, { ...series, status: "ready", story_bible: bible });
    return { job: store.jobs.get(job.id)!, bible, characters: store.charactersFor(series.id) };
  }

  async function restoreAppearance(character: Character): Promise<Character | null> {
    const refs = faceRefsFor(character);
    if (Object.keys(refs).length > 0) {
      if (Object.keys(character.visual_reference_asset_ids).length === 0) {
        const next = { ...character, visual_reference_asset_ids: refs, updated_at: iso(clock) };
        store.characters.set(character.id, next);
        return next;
      }
      return character;
    }
    const existing = findJobByKey(`appearance:${character.id}`);
    const saved = (existing?.result_metadata.refs ?? null) as Partial<Record<VisualReferenceKind, string>> | null;
    if (!saved || Object.keys(saved).length === 0) return null;
    const next = {
      ...character,
      visual_reference_asset_ids: saved,
      updated_at: iso(clock),
    };
    store.characters.set(character.id, next);
    return next;
  }

  const STILL_LOOK_ATTEMPTS = 5;
  const LIKENESS_LOOK_ATTEMPTS = 5;
  const LIKENESS_WARDROBE =
    "contemporary modest clothes: a closed jacket over a buttoned shirt, opaque cloth to the throat";

  /**
   * Beauty gate for NEW stills only. Old locked Mara/Cole PNGs are not re-gated.
   * A faithful likeness keeps the uploaded face: beauty is recorded, not vetoed.
   */
  async function gateNewCharacterStill(input: {
    bytes: Uint8Array;
    mime: string;
    kind: string;
    faceText?: string | null;
    reference?: { bytes: Uint8Array; mime_type: string } | null;
    mode?: "likeness" | "generated";
    identityFidelity?: "faithful" | "idealized";
  }): Promise<{ notes: string | null }> {
    const tight = input.kind === "cu" || input.kind === "front" || input.kind === "three_quarter" || input.kind === "profile";
    const faithful = input.mode === "likeness" && input.identityFidelity !== "idealized";
    const text = screenCastLook({ notes: input.faceText, checkDistance: false });
    if (!text.pass) throw new Error(`CAST_LOOK: ${text.reasons.join(", ")}`);
    const locate = ai.vision?.locateFace;
    const judge = ai.vision?.judgeCastLook;
    if (!locate && !judge && !(faithful && input.reference && ai.vision?.judgeIdentity)) return { notes: null };
    let box: { width: number; height: number } | null = null;
    if (locate) {
      const found = await locate({ image: input.bytes, imageMime: input.mime });
      box = found ? { width: found.width, height: found.height } : null;
    }
    let beauty: boolean | null = null;
    let modest: boolean | null = null;
    let close: boolean | null = null;
    let eyesNatural: boolean | null = null;
    let headTurn: string | null = null;
    let notes: string | null = null;
    if (judge) {
      const look = await judge({ image: input.bytes, imageMime: input.mime });
      if (look.production_gear_present && look.production_gear_evidence?.trim()) {
        throw new Error(`CAST_LOOK: production_gear (${look.production_gear_evidence})`);
      }
      if (look.eyes_natural === false) {
        throw new Error(`CAST_LOOK: eyes_unnatural (${look.eye_evidence?.trim() || "iris glows or does not match"})`);
      }
      beauty = look.beauty;
      modest = look.modest;
      close = look.close;
      eyesNatural = look.eyes_natural ?? null;
      headTurn = look.head_turn ?? null;
      notes = look.notes;
    }
    if (faithful && input.reference && ai.vision?.judgeIdentity) {
      const identity = await ai.vision.judgeIdentity({
        reference: input.reference.bytes,
        referenceMime: input.reference.mime_type,
        frames: [input.bytes],
        frameMime: input.mime,
        expectedFaces: 1,
        description: input.faceText,
      });
      if (identity.face_count !== 1 || identity.same_person < 0.75) {
        throw new Error(`CAST_LOOK: identity_or_skin_tone_drift (${identity.same_person.toFixed(2)})`);
      }
    }
    const verdict = screenCastLook({
      faceBox: box,
      notes: faithful ? null : notes,
      eyeNotes: notes,
      beauty: faithful ? null : beauty,
      modest,
      close,
      eyesNatural,
      kind: input.kind,
      headTurn,
      checkDistance: tight && Boolean(locate || judge),
    });
    if (!verdict.pass) throw new Error(`CAST_LOOK: ${verdict.reasons.join(", ")}`);
    return { notes };
  }

  async function generateGatedStill(input: {
    characterName: string;
    description: string;
    kind: string;
    faceText?: string | null;
    seed?: { bytes: Uint8Array; mime_type: string } | null;
    style?: { bytes: Uint8Array; mime_type: string } | null;
    mode?: "likeness" | "generated";
    identityFidelity?: "faithful" | "idealized";
    replaceWardrobe?: string;
  }): Promise<{ bytes: Uint8Array; mime_type: string; notes: string | null }> {
    const text = screenCastLook({ notes: input.faceText, checkDistance: false });
    if (!text.pass) throw new Error(`CAST_LOOK: ${text.reasons.join(", ")}`);
    const attempts = input.mode === "likeness" ? LIKENESS_LOOK_ATTEMPTS : STILL_LOOK_ATTEMPTS;
    let lastError: unknown = null;
    // A generated pack has no uploaded photo, so its own locked front still is
    // the only thing that makes the four angles one person. Without it every
    // kind was drawn from text alone and the pack drifted: a different haircut,
    // a different suit, and a different eye colour in each still.
    const anchor = input.seed ?? input.style ?? null;
    const anchorIsSeed = Boolean(input.seed);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const rejection = lastError instanceof Error ? lastError.message : null;
      // A style anchor is another still from the same pack, so a defect in it —
      // a lit iris, a head that will not turn — is copied into every retry and
      // the whole pack fails. An uploaded photo is the point of a likeness and
      // is never dropped; a pack still is, on the last attempt.
      const inherited = rejection ? /eyes_unnatural|pose_mismatch/i.test(rejection) : false;
      const useAnchor = anchorIsSeed || attempt < attempts - 1 || !inherited ? anchor : null;
      let candidate: { bytes: Uint8Array; mime_type: string };
      try {
        candidate = useAnchor
          ? await ai.image.generateReferenceFromSeed({
              characterName: input.characterName,
              description: input.description,
              kind: input.kind,
              seed_bytes: useAnchor.bytes,
              seed_mime_type: useAnchor.mime_type,
              style_bytes: anchorIsSeed ? input.style?.bytes : undefined,
              style_mime_type: anchorIsSeed ? input.style?.mime_type : undefined,
              retry_attempt: attempt,
              retry_note: stillRetryNote(rejection),
              replaceWardrobe: input.replaceWardrobe,
              mode: input.mode,
            })
          : await ai.image.generateReference({
              characterName: input.characterName,
              description: input.description,
              kind: input.kind,
            });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (input.seed && isPrivacyRefusal(message)) {
          throw new Error("the image provider refused this photo as a real person");
        }
        lastError = error;
        continue;
      }
      try {
        const gated = await gateNewCharacterStill({
          bytes: candidate.bytes,
          mime: candidate.mime_type,
          kind: input.kind,
          faceText: input.faceText,
          mode: input.mode,
          identityFidelity: input.identityFidelity,
          reference: input.seed,
        });
        return { ...candidate, notes: gated.notes };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("CAST_LOOK: still failed the beauty gate");
  }

  async function generateAppearance(input: { owner_id: string; character_id: string }) {
    let character = requireCharacter(input.character_id, input.owner_id);
    const restored = await restoreAppearance(character);
    if (restored) return restored;
    if (character.locked) throw new Error("Character is locked");
    await moderate(
      `${character.name}\n${character.description}\n${character.voice_profile.design_prompt}`,
      "character_create",
      character.series_id,
      null,
    );
    const actor = ensureActorForCharacter(character, input.owner_id);
    character = requireCharacter(input.character_id, input.owner_id);
    const job = createJob({
      owner_id: input.owner_id,
      series_id: character.series_id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/reference-pack",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: `appearance:${character.id}`,
      status: "queued",
      request_metadata: { character_id: character.id, actor_id: actor.id },
      estimated_cost: ai.pricing.estimateImage() * FACE_KIND_ORDER.length,
      expected_ready_at: addSeconds(clock, 30),
    });
    if (job.status === "completed") {
      return (await restoreAppearance(requireCharacter(input.character_id, input.owner_id))) ?? requireCharacter(input.character_id, input.owner_id);
    }
    if (job.status !== "queued" && job.status !== "failed") {
      return character;
    }
    if (!reservedForJob(store.ledger, job.id)) reserve(job);
    const description = appearanceDescription({
      description: character.description,
      ...character.appearance_profile,
    });
    const refs: Partial<Record<VisualReferenceKind, string>> = { ...actor.visual_reference_asset_ids };
    let style: { bytes: Uint8Array; mime_type: string } | null = null;
    for (const kind of FACE_KIND_ORDER) {
      if (refs[kind]) continue;
      const image = await generateGatedStill({
        characterName: character.name,
        description,
        kind,
        faceText: character.appearance_profile.face,
        style,
      });
      const asset = await putAsset({
        owner_id: input.owner_id,
        series_id: character.series_id,
        actor_id: actor.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { character_id: character.id, actor_id: actor.id, kind },
      });
      refs[kind] = asset.id;
      if (!style) style = { bytes: image.bytes, mime_type: image.mime_type };
    }
    store.actors.set(actor.id, { ...actor, visual_reference_asset_ids: refs, updated_at: iso(clock) });
    const next = {
      ...character,
      actor_id: actor.id,
      visual_reference_asset_ids: refs,
      updated_at: iso(clock),
    };
    store.characters.set(character.id, next);
    completeSyncJob(job, job.estimated_cost, { character_id: character.id, actor_id: actor.id, refs });
    return next;
  }

  function createActor(input: {
    owner_id: string;
    name: string;
    source?: ActorSource;
    appearance_profile?: AppearanceProfile;
    seed_asset_id?: string | null;
  }): Actor {
    const actor: Actor = {
      id: ids.id(),
      owner_id: input.owner_id,
      name: input.name,
      source: input.source ?? "generated",
      seed_asset_id: input.seed_asset_id ?? null,
      appearance_profile: input.appearance_profile ?? emptyAppearance(),
      visual_reference_asset_ids: {},
      identity_fidelity: "faithful",
      judge_notes: null,
      created_at: iso(clock),
      updated_at: iso(clock),
    };
    store.actors.set(actor.id, actor);
    return actor;
  }

  async function generateActor(input: {
    owner_id: string;
    actor_id: string;
    series_id: string;
    seed_bytes?: Uint8Array;
    seed_mime_type?: string;
    seed_asset_id?: string;
    onProgress?: (actor: Actor) => Promise<void>;
  }) {
    let actor = store.actors.get(input.actor_id);
    if (!actor || actor.owner_id !== input.owner_id) throw new Error("Actor not found");
    requireSeries(input.series_id, input.owner_id);
    if (input.seed_asset_id && input.seed_asset_id !== actor.seed_asset_id) {
      actor = {
        ...actor,
        seed_asset_id: input.seed_asset_id,
        source: "likeness",
        visual_reference_asset_ids: {},
        judge_notes: null,
        updated_at: iso(clock),
      };
      store.actors.set(actor.id, actor);
      await input.onProgress?.(actor);
    }
    if (input.seed_bytes && !actor.seed_asset_id) {
      const seed = await putAsset({
        owner_id: input.owner_id,
        series_id: input.series_id,
        actor_id: actor.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: input.seed_mime_type ?? "image/png",
        body: input.seed_bytes,
        metadata: { actor_id: actor.id, kind: "seed" },
      });
      actor = { ...actor, seed_asset_id: seed.id, source: "likeness", updated_at: iso(clock) };
      store.actors.set(actor.id, actor);
      await input.onProgress?.(actor);
    }
    const refs: Partial<Record<VisualReferenceKind, string>> = { ...actor.visual_reference_asset_ids };
    const missing = FACE_KIND_ORDER.filter((kind) => !refs[kind]);
    if (missing.length === 0) return actor;
    await moderate(
      `${actor.name}\n${appearanceDescription(actor.appearance_profile)}`,
      "character_create",
      input.series_id,
      null,
    );
    const job = createJob({
      owner_id: input.owner_id,
      series_id: input.series_id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/actor-pack",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: freshJobKey(`appearance:actor:${actor.id}:${actor.seed_asset_id ?? "none"}`),
      status: "queued",
      request_metadata: { actor_id: actor.id, seed_asset_id: actor.seed_asset_id },
      estimated_cost: ai.pricing.estimateImage() * missing.length,
      expected_ready_at: addSeconds(clock, 30),
    });
    if (job.status === "completed") {
      const done = (job.result_metadata.refs ?? refs) as Partial<Record<VisualReferenceKind, string>>;
      const next = { ...actor, visual_reference_asset_ids: { ...refs, ...done }, updated_at: iso(clock) };
      store.actors.set(actor.id, next);
      return next;
    }
    if (job.status !== "queued" && job.status !== "failed") return actor;
    if (job.status === "failed") {
      store.jobs.set(job.id, transitionJob(job, "queued", iso(clock), { error_code: null }));
    }
    if (!reservedForJob(store.ledger, job.id)) reserve(job);
    const description = appearanceDescription({ description: actor.name, ...actor.appearance_profile });
    const seed = actor.seed_asset_id ? await assets.get(actor.seed_asset_id) : null;
    const likeness = Boolean(seed) || actor.source === "likeness";
    const fidelity = actor.identity_fidelity === "idealized" ? "idealized" : "faithful";
    const replaceWardrobe = likeness
      ? actor.appearance_profile.default_wardrobe?.trim() || LIKENESS_WARDROBE
      : undefined;
    let style: { bytes: Uint8Array; mime_type: string } | null = null;
    // Front is the preferred anchor, but redoing a bad front must not orphan the
    // stills that stay: without a fallback the new front is drawn from text and
    // comes back as a different person than the rest of the pack.
    const styleId = refs.front ?? FACE_KIND_ORDER.map((kind) => refs[kind]).find(Boolean);
    if (styleId) {
      const lockedStyle = await assets.get(styleId);
      if (lockedStyle) style = { bytes: lockedStyle.body, mime_type: lockedStyle.asset.mime_type };
    }
    try {
    for (const kind of missing) {
      const image = await generateGatedStill({
        characterName: actor.name,
        description,
        kind,
        faceText: actor.appearance_profile.face,
        seed: seed ? { bytes: seed.body, mime_type: seed.asset.mime_type } : null,
        style,
        mode: likeness ? "likeness" : "generated",
        identityFidelity: fidelity,
        replaceWardrobe,
      });
      const asset = await putAsset({
        owner_id: input.owner_id,
        series_id: input.series_id,
        actor_id: actor.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { actor_id: actor.id, kind },
      });
      refs[kind] = asset.id;
      if (!style && kind === "front") {
        style = { bytes: image.bytes, mime_type: image.mime_type };
      }
      actor = {
        ...actor,
        visual_reference_asset_ids: { ...refs },
        judge_notes: image.notes ?? actor.judge_notes ?? null,
        updated_at: iso(clock),
      };
      store.actors.set(actor.id, actor);
      for (const character of store.characters.values()) {
        if (character.actor_id === actor.id && !character.locked) {
          store.characters.set(character.id, {
            ...character,
            visual_reference_asset_ids: { ...character.visual_reference_asset_ids, ...refs },
            updated_at: iso(clock),
          });
        }
      }
      await input.onProgress?.(actor);
    }
    completeSyncJob(job, job.estimated_cost, { actor_id: actor.id, refs });
    return actor;
    } catch (error) {
      const message = error instanceof Error ? error.message : "actor_pack_failed";
      recordJobError(store.jobs.get(job.id) ?? job, message);
      throw error;
    }
  }

  async function attachActor(input: { owner_id: string; character_id: string; actor_id: string }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    if (character.locked) throw new Error("Character is locked");
    const actor = store.actors.get(input.actor_id);
    if (!actor || actor.owner_id !== input.owner_id) throw new Error("Actor not found");
    const next = {
      ...character,
      actor_id: actor.id,
      visual_reference_asset_ids: { ...actor.visual_reference_asset_ids },
      appearance_profile:
        actor.appearance_profile.hair || actor.appearance_profile.face
          ? actor.appearance_profile
          : character.appearance_profile,
      updated_at: iso(clock),
    };
    store.characters.set(character.id, next);
    return next;
  }

  async function generateWardrobe(input: { owner_id: string; character_id: string }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    const series = requireSeries(character.series_id, input.owner_id);
    const looks = looksFromBible({
      locations: series.story_bible?.locations,
      default_wardrobe: character.default_wardrobe || character.appearance_profile.default_wardrobe,
    });
    const faceId = preferredFaceId(faceRefsFor(character));
    if (!faceId) throw new Error("Character stills are required before wardrobe");
    const seed = await assets.get(faceId);
    if (!seed) throw new Error("Face still missing");
    const wardrobe = { ...character.wardrobe_asset_ids };
    const description = appearanceDescription({
      description: character.description,
      ...character.appearance_profile,
    });
    for (const look of looks) {
      if (wardrobe[look]) continue;
      const key = `wardrobe:${character.id}:${look}`;
      const existing = findJobByKey(key);
      if (existing?.status === "completed" && typeof existing.result_metadata.asset_id === "string") {
        wardrobe[look] = String(existing.result_metadata.asset_id);
        continue;
      }
      const job = createJob({
        owner_id: input.owner_id,
        series_id: character.series_id,
        episode_id: null,
        scene_id: null,
        shot_id: null,
        job_type: "image",
        model: "image/wardrobe",
        provider: "openrouter",
        upstream_job_id: null,
        idempotency_key: key,
        status: "queued",
        request_metadata: { character_id: character.id, look },
        estimated_cost: ai.pricing.estimateImage(),
        expected_ready_at: addSeconds(clock, 30),
      });
      if (job.status === "completed" && typeof job.result_metadata.asset_id === "string") {
        wardrobe[look] = String(job.result_metadata.asset_id);
        continue;
      }
      if (job.status !== "queued" && job.status !== "failed") continue;
      if (!reservedForJob(store.ledger, job.id)) reserve(job);
      const image = await ai.image.generateReferenceFromSeed({
        characterName: character.name,
        description: `${description}. ${lookPrompt(look, character.default_wardrobe)}`,
        kind: look,
        seed_bytes: seed.body,
        seed_mime_type: seed.asset.mime_type,
      });
      const asset = await putAsset({
        owner_id: input.owner_id,
        series_id: character.series_id,
        actor_id: character.actor_id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { character_id: character.id, kind: `look:${look}`, look },
      });
      wardrobe[look] = asset.id;
      completeSyncJob(job, job.estimated_cost, { character_id: character.id, look, asset_id: asset.id });
    }
    const next = { ...character, wardrobe_asset_ids: wardrobe, updated_at: iso(clock) };
    store.characters.set(character.id, next);
    return next;
  }

  async function loadPendingCandidates(character: Character): Promise<VoiceCandidate[]> {
    const cached = pendingVoices.get(character.id);
    if (cached && cached.length > 0) return cached;
    const pending = character.voice_profile.pending_previews ?? [];
    const loaded: VoiceCandidate[] = [];
    for (const preview of pending) {
      let stored: Awaited<ReturnType<typeof assets.get>> = null;
      try {
        stored = await assets.get(preview.asset_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Media store GET failed";
        throw new Error(`${message} for voice_preview ${preview.asset_id}`);
      }
      if (!stored) {
        throw new Error(`Media store GET failed HTTP 404 for voice_preview ${preview.asset_id}`);
      }
      loaded.push({
        preview_id: preview.preview_id,
        elevenlabs_voice_id: preview.elevenlabs_voice_id,
        preview_label: preview.preview_label,
        preview_audio_bytes: stored.body,
        preview_mime_type: preview.mime_type,
      });
    }
    if (loaded.length) pendingVoices.set(character.id, loaded);
    return loaded;
  }

  async function persistVoiceCandidates(character: Character, candidates: VoiceCandidate[]) {
    const pending = [];
    for (const candidate of candidates) {
      const asset = await putAsset({
        owner_id: store.series.get(character.series_id)!.owner_id,
        series_id: character.series_id,
        kind: "voice_preview",
        bucket: "private-character",
        mime_type: candidate.preview_mime_type,
        body: candidate.preview_audio_bytes,
        metadata: { character_id: character.id, preview_id: candidate.preview_id },
      });
      pending.push({
        preview_id: candidate.preview_id,
        elevenlabs_voice_id: candidate.elevenlabs_voice_id,
        preview_label: candidate.preview_label,
        asset_id: asset.id,
        mime_type: candidate.preview_mime_type,
      });
    }
    const latest = store.characters.get(character.id)!;
    store.characters.set(character.id, {
      ...latest,
      voice_profile: {
        ...latest.voice_profile,
        pending_previews: pending,
      },
      updated_at: iso(clock),
    });
    pendingVoices.set(character.id, candidates);
    return pending;
  }

  function completedVoiceJob(characterId: string) {
    return [...store.jobs.values()]
      .filter(
        (job) =>
          job.job_type === "voice_design" &&
          job.status === "completed" &&
          String(job.request_metadata.character_id ?? "") === characterId,
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  }

  function pendingFromJob(job: NonNullable<ReturnType<typeof completedVoiceJob>>) {
    const ids = job.result_metadata.preview_ids;
    const assetIds = job.result_metadata.preview_asset_ids;
    if (!Array.isArray(ids) || !Array.isArray(assetIds)) return [];
    return ids
      .map((previewId, index) => {
        const assetId = assetIds[index];
        if (typeof previewId !== "string" || typeof assetId !== "string" || !assetId) return null;
        return {
          preview_id: previewId,
          elevenlabs_voice_id: previewId,
          preview_label: String.fromCharCode(65 + index),
          asset_id: assetId,
          mime_type: "audio/mpeg",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  async function pendingFromAssets(characterId: string, seriesId: string) {
    const listed = await assets.listBySeries(seriesId);
    return listed
      .filter(
        (asset) =>
          asset.kind === "voice_preview" &&
          !asset.deleted_at &&
          String(asset.metadata.character_id ?? "") === characterId,
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map((asset, index) => {
        const previewId = String(asset.metadata.preview_id ?? asset.id);
        return {
          preview_id: previewId,
          elevenlabs_voice_id: String(asset.metadata.elevenlabs_voice_id ?? previewId),
          preview_label: String.fromCharCode(65 + index),
          asset_id: asset.id,
          mime_type: asset.mime_type || "audio/mpeg",
        };
      });
  }

  async function restorePending(character: Character) {
    const finished = completedVoiceJob(character.id);
    let pending = finished ? pendingFromJob(finished) : [];
    if (!pending.length) pending = await pendingFromAssets(character.id, character.series_id);
    return writePending(character, pending);
  }

  function writePending(
    character: Character,
    pending: ReturnType<typeof pendingFromJob>,
  ) {
    if (!pending.length) return character;
    const next = {
      ...character,
      voice_profile: { ...character.voice_profile, pending_previews: pending },
      updated_at: iso(clock),
    };
    store.characters.set(character.id, next);
    return next;
  }

  function isExpiredVoiceSave(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      /HTTP (400|404|410|422)/i.test(message) &&
      /elevenlabs|text-to-voice|generated_voice|expired|invalid|no longer/i.test(message)
    );
  }

  async function existingVoiceReference(character: Character) {
    const listed = await assets.listBySeries(character.series_id);
    return (
      listed.find((asset) => {
        const voiceId = asset.metadata.elevenlabs_voice_id;
        return (
          asset.kind === "voice_reference" &&
          !asset.deleted_at &&
          String(asset.metadata.character_id ?? "") === character.id &&
          typeof voiceId === "string" &&
          Boolean(voiceId)
        );
      }) ?? null
    );
  }

  function applyLockedVoice(character: Character, voiceId: string, referenceId: string) {
    const latest = store.characters.get(character.id)!;
    const locked: Character = {
      ...latest,
      locked: true,
      voice_profile: {
        ...latest.voice_profile,
        elevenlabs_voice_id: voiceId,
        canonical_reference_asset_id: referenceId,
        voice_version: latest.voice_profile.voice_version || 1,
        locked: true,
      },
      updated_at: iso(clock),
    };
    store.characters.set(locked.id, locked);
    pendingVoices.delete(character.id);
    return locked;
  }

  async function runVoiceDesign(
    input: { owner_id: string; character_id: string },
    idempotencyKey: string,
  ) {
    const ready = requireCharacter(input.character_id, input.owner_id);
    await moderate(ready.voice_profile.design_prompt, "character_create", ready.series_id, null);
    const job = createJob({
      owner_id: input.owner_id,
      series_id: ready.series_id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "voice_design",
      model: "elevenlabs/voice-design",
      provider: "elevenlabs",
      upstream_job_id: null,
      idempotency_key: idempotencyKey,
      status: "queued",
      request_metadata: { character_id: ready.id },
      estimated_cost: ai.pricing.estimateVoiceDesign(),
      expected_ready_at: addSeconds(clock, 20),
    });
    if (job.status === "completed") {
      writePending(ready, pendingFromJob(job));
      const again = await loadPendingCandidates(requireCharacter(input.character_id, input.owner_id));
      if (!again.length) {
        throw new Error("Voice design already finished. Previews could not be loaded. Not calling Voice Design again.");
      }
      return { character: requireCharacter(input.character_id, input.owner_id), candidates: again, job };
    }
    if (!reservedForJob(store.ledger, job.id)) reserve(job);
    const candidates = await ai.speech.designVoice(ready.voice_profile.design_prompt);
    await persistVoiceCandidates(ready, candidates);
    const persisted = store.characters.get(ready.id)!;
    if ((persisted.voice_profile.pending_previews ?? []).length === 0) {
      throw new Error("Voice design finished but pending_previews were not persisted.");
    }
    completeSyncJob(job, job.estimated_cost, {
      character_id: ready.id,
      preview_ids: candidates.map((candidate) => candidate.preview_id),
      preview_asset_ids: persisted.voice_profile.pending_previews?.map((item) => item.asset_id) ?? [],
    });
    return { character: persisted, candidates, job: store.jobs.get(job.id)! };
  }

  async function designVoice(input: { owner_id: string; character_id: string }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    if (character.voice_profile.elevenlabs_voice_id && character.voice_profile.locked) {
      return { character, candidates: pendingVoices.get(character.id) ?? [], job: null };
    }
    if (character.locked) throw new Error("Character is locked");
    const aligned = alignVoicePrompt(
      character.voice_profile.design_prompt,
      `${character.name}. ${character.description}`,
    );
    if (aligned !== character.voice_profile.design_prompt) {
      store.characters.set(character.id, {
        ...character,
        voice_profile: { ...character.voice_profile, design_prompt: aligned },
      });
    }
    await restorePending(store.characters.get(character.id)!);
    const current = store.characters.get(character.id)!;
    const existingCandidates = await loadPendingCandidates(current);
    if (existingCandidates.length > 0) {
      return {
        character: current,
        candidates: existingCandidates,
        job:
          completedVoiceJob(current.id) ??
          findJobByKey(`voice-design:${current.id}:${current.voice_profile.voice_version}`) ??
          null,
      };
    }
    if (completedVoiceJob(current.id)) {
      throw new Error("Voice design already finished. Previews could not be loaded. Not calling Voice Design again.");
    }
    const version =
      aligned === character.voice_profile.design_prompt
        ? current.voice_profile.voice_version
        : current.voice_profile.voice_version + 1;
    if (version !== current.voice_profile.voice_version) {
      store.characters.set(current.id, {
        ...current,
        voice_profile: { ...current.voice_profile, voice_version: version },
      });
    }
    const ready = store.characters.get(current.id)!;
    return runVoiceDesign(input, `voice-design:${ready.id}:${ready.voice_profile.voice_version}`);
  }

  async function redesignVoiceOnce(input: { owner_id: string; character_id: string }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    const key = `voice-design:${character.id}:${character.voice_profile.voice_version}:redesign-1`;
    const existing = findJobByKey(key);
    if (existing?.status === "completed") {
      writePending(character, pendingFromJob(existing));
      const loaded = await loadPendingCandidates(store.characters.get(character.id)!);
      if (!loaded.length) {
        throw new Error("Voice redesign already finished. Previews could not be loaded. Not calling Voice Design again.");
      }
      return loaded;
    }
    if (existing && isActive(existing.status)) {
      throw new Error("Voice redesign is already in progress.");
    }
    const designed = await runVoiceDesign(input, key);
    return designed.candidates;
  }

  async function lockCharacter(input: {
    owner_id: string;
    character_id: string;
    voice_candidate_id?: string;
    /**
     * Face only. Scene takes speak natively through the video model, so a TTS
     * voice is not part of the lock for that SKU; the voice can be added later
     * when a TTS lane (voice over) needs it.
     */
    face_only?: boolean;
  }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    if (character.locked && (character.voice_profile.elevenlabs_voice_id || input.face_only)) return character;
    if (Object.keys(faceRefsFor(character)).length === 0) {
      await generateAppearance(input);
    }
    if (input.face_only) {
      // The wardrobe states are part of the face lock for scene takes: the
      // person in this clothing, in that clothing, matched to the rooms.
      await generateWardrobe({ owner_id: input.owner_id, character_id: character.id });
      const latest = store.characters.get(character.id)!;
      const locked: Character = { ...latest, locked: true, updated_at: iso(clock) };
      store.characters.set(locked.id, locked);
      return locked;
    }
    const reference = await existingVoiceReference(store.characters.get(character.id)!);
    if (reference && typeof reference.metadata.elevenlabs_voice_id === "string") {
      return applyLockedVoice(
        store.characters.get(character.id)!,
        reference.metadata.elevenlabs_voice_id,
        reference.id,
      );
    }
    await restorePending(store.characters.get(character.id)!);
    let candidates = await loadPendingCandidates(store.characters.get(character.id)!);
    if (!candidates.length) {
      candidates = (await designVoice(input)).candidates;
    }
    const chosen = input.voice_candidate_id
      ? candidates.find((candidate) => candidate.preview_id === input.voice_candidate_id)
      : candidates[0];
    if (!chosen) {
      throw new Error("Unknown voice candidate. Call designVoice first and pick a preview.");
    }
    let identity: { elevenlabs_voice_id: string };
    try {
      identity = await ai.speech.saveVoice(chosen, {
        name: character.name,
        description: store.characters.get(character.id)!.voice_profile.design_prompt,
      });
    } catch (error) {
      if (!isExpiredVoiceSave(error)) throw error;
      const redesigned = await redesignVoiceOnce(input);
      const next = input.voice_candidate_id
        ? redesigned.find((candidate) => candidate.preview_id === input.voice_candidate_id)
        : redesigned[0];
      if (!next) throw error;
      identity = await ai.speech.saveVoice(next, {
        name: character.name,
        description: store.characters.get(character.id)!.voice_profile.design_prompt,
      });
      chosen.preview_audio_bytes = next.preview_audio_bytes;
      chosen.preview_mime_type = next.preview_mime_type;
    }
    const saved = await putAsset({
      owner_id: input.owner_id,
      series_id: character.series_id,
      kind: "voice_reference",
      bucket: "private-character",
      mime_type: chosen.preview_mime_type,
      body: chosen.preview_audio_bytes,
      metadata: { character_id: character.id, elevenlabs_voice_id: identity.elevenlabs_voice_id },
    });
    return applyLockedVoice(store.characters.get(character.id)!, identity.elevenlabs_voice_id, saved.id);
  }

  /**
   * One judged plate for one room. The plate seeds every wide in this location,
   * so a person in it is a person in every wide: judge it and regenerate until
   * the room is empty, then fail rather than ship a populated set.
   */
  async function renderLocationPlate(
    series: { id: string; owner_id: string },
    rawLocation: string,
  ): Promise<{ assetId: string; notes: Record<string, unknown> }> {
    // "board" is a clapperboard to the image model. Expand before we ask it.
    const location = expandPlaceName(rawLocation);
    let image: Awaited<ReturnType<typeof ai.image.generateReference>> | null = null;
    let peoplePresent: boolean | null = null;
    let placeholderLettering: boolean | null = null;
    let productionGearPresent: boolean | null = null;
    let notes: Record<string, unknown> = {};
    // The physical description only; a name like "wall of household files"
    // reads as a household and the model staffs it.
    const physical = location.split(/\s[—–-]\s/).slice(1).join(", ").trim() || location;
    for (let attempt = 0; attempt < LOCATION_PLATE_ATTEMPTS; attempt += 1) {
      const candidate = await ai.image.generateReference({
        characterName: location,
        description:
          attempt === 0
            ? `Cinematic establishing still of ${location}, exactly as its description implies — its time of day, weather, and materials. One motivated light and grade. ` +
              `${placeLockClause(location)} EMPTY. NO people, NO faces, NO extras, NO bodies, no silhouettes, no figures with their back to camera. ${placeLettering(location)}`
            : `${placePlateRetry(location, physical)} Wide 9:16 frame, one key light and grade, cinematic colour. Empty and still. ${placeLettering(location)}`,
        kind: "location",
      });
      image = candidate;
      if (!ai.vision?.describeLocation) break;
      // One vision call does both jobs: the lighting note every close-up will
      // carry, and a strict "is anyone in this room" check (silhouettes and
      // back-to-camera figures have no face and would pass a face count).
      try {
        const small = await shrinkReference(candidate.bytes);
        const described = await ai.vision.describeLocation({ plate: small?.bytes ?? candidate.bytes, plateMime: small?.mime ?? candidate.mime_type, location });
        peoplePresent = described.people_present;
        placeholderLettering = described.placeholder_lettering;
        productionGearPresent = described.production_gear_present;
        notes = {
          lighting_lock: described.lighting_lock,
          palette: described.palette,
          key_light: described.key_light,
          dressing: described.dressing,
          people_present: described.people_present,
          placeholder_lettering: described.placeholder_lettering,
          production_gear_present: described.production_gear_present,
          ...(described.geometry ? { geometry: described.geometry } : {}),
        };
        if (!described.people_present && !described.placeholder_lettering && !described.production_gear_present) break;
      } catch (caught) {
        // Without vision nothing checks the room is empty, so say so loudly
        // rather than shipping an unjudged plate in silence.
        console.warn(
          JSON.stringify(
            publicLog({
              event: "location_plate_unjudged",
              series_id: series.id,
              location,
              reason: caught instanceof Error ? caught.message : "vision failed",
            }),
          ),
        );
        break;
      }
    }
    if (!image) throw new Error(`Could not generate a location plate for ${location}`);
    if (peoplePresent) {
      throw new Error(`Location plate for ${location} still shows a human figure after ${LOCATION_PLATE_ATTEMPTS} attempts`);
    }
    if (placeholderLettering) {
      throw new Error(`Location plate for ${location} still shows dummy lettering or a leaked prop after ${LOCATION_PLATE_ATTEMPTS} attempts`);
    }
    if (productionGearPresent) {
      throw new Error(`Location plate for ${location} still shows filmmaking equipment after ${LOCATION_PLATE_ATTEMPTS} attempts`);
    }
    const asset = await putAsset({
      owner_id: series.owner_id,
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      mime_type: image.mime_type,
      body: image.bytes,
      metadata: { location, ...notes },
    });
    return { assetId: asset.id, notes };
  }

  /**
   * One room, generated on demand from the design screen. The plate lands in
   * `location_refs` under its own name, which is the key the shoot already
   * matches scenes against, so approving a room here is what the run uses.
   */
  async function lockLocation(input: {
    owner_id: string;
    series_id: string;
    location: string;
    force?: boolean;
  }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const location = input.location.trim();
    if (!location) throw new Error("A location name is required");
    const existing = series.location_refs?.[location];
    const views = roomAnglesFor(location);
    const existingPack = existing
      ? await listedRoomAngles(series.id, location, existing)
      : [];
    if (existing && !input.force && existingPack.length >= views.length) {
      return { series, asset_id: existing, notes: {} as Record<string, unknown>, reused: true };
    }
    const remaining = existing && !input.force ? Math.max(0, views.length - existingPack.length) : 1 + views.length;
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/location-plate",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: freshJobKey(`location:${series.id}:${location}`),
      status: "queued",
      request_metadata: { location, pack: views.map((row) => row.angle) },
      estimated_cost: ai.pricing.estimateImage() * Math.max(1, remaining),
      expected_ready_at: addSeconds(clock, 180),
    });
    reserve(job);
    const plate =
      existing && !input.force
        ? { assetId: existing, notes: {} as Record<string, unknown> }
        : await renderLocationPlate({ id: series.id, owner_id: series.owner_id }, location);
    const refs = { ...series.location_refs, [location]: plate.assetId };
    const next = { ...series, location_refs: refs };
    store.series.set(series.id, next);
    await ensureRoomAngles(series.id, location, plate.assetId, { required: true });
    completeSyncJob(job, job.estimated_cost, { location, asset_id: plate.assetId });
    return { series: next, asset_id: plate.assetId, notes: plate.notes, reused: Boolean(existing && !input.force) };
  }

  /**
   * One plate for the catalog, with no show attached.
   *
   * The places page builds a room before any story asks for it, so nothing is
   * written into a show's own location map here. The job is still hosted on a
   * series for billing and the task trail, the way an actor's face pack is.
   */
  async function renderLibraryPlate(input: { owner_id: string; series_id: string; name: string }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const name = input.name.trim();
    if (!name) throw new Error("A place needs a name");
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/location-plate",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: freshJobKey(`library-place:${series.owner_id}:${name}`),
      status: "queued",
      request_metadata: { location: name, library: true },
      estimated_cost: ai.pricing.estimateImage() * (1 + roomAnglesFor(name).length),
      expected_ready_at: addSeconds(clock, 180),
    });
    reserve(job);
    const plate = await renderLocationPlate({ id: series.id, owner_id: series.owner_id }, name);
    await ensureRoomAngles(series.id, name, plate.assetId, { required: true });
    completeSyncJob(job, job.estimated_cost, { location: name, asset_id: plate.assetId });
    return { asset_id: plate.assetId, notes: plate.notes };
  }

  async function lockLocations(input: { owner_id: string; series_id: string }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const locations = series.story_bible?.locations ?? [];
    if (locations.length === 0) return series;
    const refs = { ...series.location_refs };
    const missing = locations.filter((location) => !refs[location]);
    if (missing.length === 0) return series;
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/location-pack",
      provider: "openrouter",
      upstream_job_id: null,
      // A re-lock (plates cleared for regeneration) is new work, not a replay of the first lock.
      idempotency_key: freshJobKey(`locations:${series.id}:${missing.join(",")}`),
      status: "queued",
      request_metadata: { locations: missing },
      estimated_cost: ai.pricing.estimateImage() * missing.reduce((sum, name) => sum + 1 + roomAnglesFor(name).length, 0),
      expected_ready_at: addSeconds(clock, 180),
    });
    reserve(job);
    for (const location of missing) {
      const plate = await renderLocationPlate({ id: series.id, owner_id: series.owner_id }, location);
      refs[location] = plate.assetId;
      store.series.set(series.id, { ...series, location_refs: refs });
      await ensureRoomAngles(series.id, location, plate.assetId, { required: true });
    }
    const next = { ...series, location_refs: refs };
    store.series.set(series.id, next);
    await lockProps({ owner_id: input.owner_id, series_id: series.id });
    completeSyncJob(job, job.estimated_cost, { location_refs: refs });
    return next;
  }

  async function createEpisode(input: {
    owner_id: string;
    series_id: string;
    episode_number: number;
    title: string;
  }) {
    requireSeries(input.series_id, input.owner_id);
    const episode: Episode = {
      id: ids.id(),
      series_id: input.series_id,
      episode_number: input.episode_number,
      title: input.title,
      script: "",
      status: "draft",
      poster_tone: "g1",
      render_version: 0,
      render_manifest: null,
      created_at: iso(clock),
      updated_at: iso(clock),
    };
    store.episodes.set(episode.id, episode);
    return episode;
  }

  /**
   * Copywriter pass: the planner writes the mechanism, the polish makes every
   * cue one short on-the-nose sentence. Speakers, beats, entrances and exits
   * survive; a rewrite that loses them or makes the talk more staged is thrown away.
   */
  async function polishScenePlan(plan: EpisodePlan, bible: StoryBible): Promise<EpisodePlan> {
    if (!ai.llm.polishSceneDialogue) return plan;
    const flat = plan.scenes.flatMap((scene) => scene.shots);
    const takes = flat
      .map((shot, index) => ({ shot, index }))
      .filter(({ shot }) => isSceneTake(shot) && typeof shot.scene_script === "string" && shot.scene_script.trim());
    if (!takes.length) return plan;
    let polished: Array<{ index: number; scene_script: string }>;
    try {
      polished = await ai.llm.polishSceneDialogue({
        bible,
        takes: takes.map(({ shot, index }) => ({ index, scene_script: shot.scene_script!, staging: shot.blocking?.staging ?? null })),
      });
    } catch (error) {
      return keepPlanAfterPolishFailure(plan, error);
    }
    const byIndex = new Map(polished.map((row) => [row.index, row.scene_script]));
    for (const { shot, index } of takes) {
      const next = byIndex.get(index);
      if (typeof next !== "string" || !next.trim()) continue;
      const before = speakersForSceneTake({ sceneScript: shot.scene_script });
      const after = speakersForSceneTake({ sceneScript: next });
      const keptExits = exitsIn(shot.scene_script).every((name) => exitsIn(next).some((row) => sameName(row, name)));
      if (!sameSpeakerCast(before, after) || !keptExits || !acceptPolishedTalk(shot.scene_script ?? "", next)) continue;
      shot.scene_script = next;
      const first = cueRows(next)[0];
      if (first) shot.dialogue = cueText(first);
    }
    const sceneShots = plan.scenes.flatMap((scene) => scene.shots).filter((shot) => isSceneTake(shot));
    for (let i = 1; i < sceneShots.length; i += 1) {
      const stripped = dropOpeningEcho(sceneShots[i - 1]!.scene_script, sceneShots[i]!.scene_script);
      if (stripped === (sceneShots[i]!.scene_script ?? "")) continue;
      sceneShots[i]!.scene_script = stripped;
      const first = cueRows(stripped)[0];
      if (first) sceneShots[i]!.dialogue = cueText(first);
    }
    return plan;
  }

  async function planEpisode(input: {
    owner_id: string;
    episode_id: string;
    bible?: StoryBible;
    episode_length?: EpisodeLength;
  }) {
    const episode = store.episodes.get(input.episode_id);
    if (!episode) throw new Error("Episode not found");
    const series = requireSeries(episode.series_id, input.owner_id);
    const bible = input.bible ?? series.story_bible;
    if (!bible) {
      throw new Error("Series has no stored story bible. Run analyze before planEpisode.");
    }
    const length = input.episode_length ?? episodeLengthFromProfile(series.style_profile);
    if (series.style_profile.episode_length !== length) {
      store.series.set(series.id, {
        ...series,
        style_profile: { ...series.style_profile, episode_length: length },
      });
    }
    const cast = store.charactersFor(series.id);
    // The scene-take SKU speaks natively through the video model; a TTS voice is
    // only required where a TTS lane exists (singles, voice over).
    const needsVoice = length !== "60_90";
    if (cast.length === 0 || cast.some((character) => !character.locked || (needsVoice && !character.voice_profile.elevenlabs_voice_id))) {
      throw new Error(needsVoice ? "Lock every character face and voice before planEpisode." : "Lock every character face before planEpisode.");
    }
    const planned = isLongFormLength(length)
      ? await planLongFormEpisode({
          bible,
          episodeNumber: episode.episode_number,
          title: episode.title,
          outlineEpisode: ai.llm.outlineEpisode
            ? (payload) => ai.llm.outlineEpisode!({ ...payload, episode_length: length })
            : undefined,
          writeEpisodeBlocks: ai.llm.writeEpisodeBlocks
            ? (payload) => ai.llm.writeEpisodeBlocks!({ ...payload, episode_length: length })
            : undefined,
        })
      : await ai.llm.planShots({
          plan: await ai.llm.writeEpisode({ bible, episodeNumber: episode.episode_number, episode_length: length }),
          bible,
          episode_length: length,
        });
    const namedCast = cast.map((character) => character.name);
    const ledger = ledgerForEpisode(episode.episode_number);
    const repairedFirst = dramaHooks.repairEpisodePlan({
      plan: planned,
      bible,
      length,
      namedCast,
      episodeNumber: episode.episode_number,
      ...ledger,
    });
    const repairedOnce = await polishScenePlan(repairedFirst, bible);
    const plan = dramaHooks.assertEpisodePlan({
      plan: dramaHooks.repairEpisodePlan({
        plan: repairedOnce,
        bible,
        length,
        namedCast,
        episodeNumber: episode.episode_number,
        ...ledger,
      }),
      bible,
      length,
      namedCast,
      episodeNumber: episode.episode_number,
      ...ledger,
    });
    const flat = plan.scenes.flatMap((scene) => scene.shots);
    const budget = dramaHooks.lengthBudget(length);
    if (flat.length < budget.min_shots || flat.length > budget.max_shots) {
      throw new Error(
        `Refusing to persist ${flat.length} shots for ${length} (need ${budget.min_shots}–${budget.max_shots})`,
      );
    }
    store.purgeEpisodePlan(episode.id);
    for (const [sceneIndex, scenePlan] of plan.scenes.entries()) {
      const location = pinLocationToBible(scenePlan.location, bible.locations ?? []) ?? scenePlan.location;
      const scene = {
        id: ids.id(),
        episode_id: episode.id,
        position: sceneIndex + 1,
        location,
        scene_data: {
          location,
          time: scenePlan.time,
          characters: scenePlan.characters,
          kind: scenePlan.kind,
          block_index: scenePlan.block_index,
        },
        status: "planned" as const,
      };
      store.scenes.set(scene.id, scene);
      for (const [shotIndex, shotPlan] of scenePlan.shots.entries()) {
        if (shotPlan.speaker) {
          characterBySpeaker(series.id, shotPlan.speaker);
        }
        const globalIndex = flat.indexOf(shotPlan);
        const craft = defaultCraftForShot(shotPlan, globalIndex >= 0 ? globalIndex : shotIndex, flat.length);
        const lookCharacter = shotPlan.speaker_on_camera ?? shotPlan.speaker;
        const lookId = lookCharacter
          ? wardrobeForScene(characterBySpeaker(series.id, lookCharacter).wardrobe_asset_ids, location)
          : null;
        const shot: Shot = {
          id: ids.id(),
          scene_id: scene.id,
          position: shotIndex + 1,
          selected_generation_id: null,
          status: "planned",
          shot_data: {
            type: shotPlan.type,
            speaker: shotPlan.speaker,
            dialogue: shotPlan.dialogue,
            emotion: shotPlan.emotion,
            delivery: shotPlan.delivery,
            pace: shotPlan.pace,
            camera: isSceneTake(shotPlan)
              ? dramaHooks.sanitizeCamera(shotPlan.camera, { single: false, lockedTake: false })
              : dramaHooks.sanitizeCamera(shotPlan.camera),
            mouth_visibility_required: shotPlan.mouth_visibility_required,
            duration_hint_seconds: shotPlan.duration_hint_seconds,
            duration_seconds: null,
            dialogue_audio_asset_id: null,
            dialogue_alignment_asset_id: null,
            hero: Boolean(shotPlan.hero),
            edit_mode: shotPlan.edit_mode ?? craft.edit_mode,
            scene_script: shotPlan.scene_script ?? null,
            heard_audio: isSceneTake(shotPlan) ? "native" : undefined,
            audio_role: shotPlan.audio_role ?? craft.audio_role,
            speaker_on_camera: shotPlan.speaker_on_camera ?? (craft.audio_role === "offscreen" ? null : shotPlan.speaker),
            speakers_off_camera: shotPlan.speakers_off_camera ?? [],
            eyeline: shotPlan.eyeline ?? craft.eyeline,
            function: shotPlan.function ?? craft.function,
            block_index: scenePlan.block_index ?? shotPlan.block_index,
            look_id: lookId,
            silence_license: shotPlan.silence_license ?? null,
            recap: Boolean(shotPlan.recap),
            camera_move: shotPlan.camera_move ?? null,
            comic_sting: Boolean(shotPlan.comic_sting),
            sfx: shotPlan.sfx ?? null,
            blocking: shotPlan.blocking,
          },
        };
        store.shots.set(shot.id, shot);
      }
    }
    const next = {
      ...episode,
      script: plan.cliffhanger,
      episode_outline: plan.outline ?? null,
      status: "planned" as const,
      updated_at: iso(clock),
    };
    store.episodes.set(episode.id, next);
    return { episode: next, scenes: store.scenesFor(episode.id), shots: store.shotsForEpisode(episode.id) };
  }

  async function generateDialogue(input: { owner_id: string; shot_id: string }) {
    const { shot, series, episode } = requireShot(input.shot_id, input.owner_id);
    // Who says the line: the off-camera speaker for an off-screen line, else the
    // speaker; empty strings and missing names fall through to the scene's cast.
    const sceneCast = store.scenes.get(shot.scene_id)?.scene_data.characters ?? [];
    const offCamera = (shot.shot_data.speakers_off_camera ?? []).find((name) => Boolean(name?.trim()));
    const talker =
      (shot.shot_data.audio_role === "offscreen" ? offCamera || shot.shot_data.speaker : shot.shot_data.speaker || offCamera) ||
      shot.shot_data.speaker_on_camera ||
      sceneCast.find((name) => Boolean(name?.trim())) ||
      null;
    if (!shot.shot_data.dialogue?.trim() || !talker) {
      throw new Error("Shot has no dialogue");
    }
    // Already voiced (a duplicate or stale task): nothing to synthesise, nothing to charge.
    if (shot.shot_data.dialogue_audio_asset_id && shot.shot_data.dialogue_alignment_asset_id) {
      const existing = [...store.jobs.values()].find((job) => job.shot_id === shot.id && job.job_type === "dialogue_tts" && job.status === "completed");
      return {
        job: existing ?? null,
        shot,
        duration: { duration_seconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds, needs_reaction_pad: Boolean(shot.shot_data.needs_reaction_pad) },
        reused: true as const,
      };
    }
    const character = characterBySpeaker(series.id, talker);
    if (!character.locked || !character.voice_profile.elevenlabs_voice_id) {
      throw new Error("Character voice is not locked");
    }
    await moderate(shot.shot_data.dialogue, "dialogue", series.id, null);
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: episode.id,
      scene_id: shot.scene_id,
      shot_id: shot.id,
      job_type: "dialogue_tts",
      model: "elevenlabs/tts",
      provider: "elevenlabs",
      upstream_job_id: null,
      idempotency_key: `tts:${shot.id}:${character.voice_profile.voice_version}${shot.shot_data.line_revision ? `:r${shot.shot_data.line_revision}` : ""}`,
      status: "queued",
      request_metadata: { speaker: character.id },
      estimated_cost: ai.pricing.estimateDialogue(),
      expected_ready_at: addSeconds(clock, 10),
    });
    reserve(job);
    const synthesized = await ai.speech.synthesize(
      {
        elevenlabs_voice_id: character.voice_profile.elevenlabs_voice_id,
        canonical_reference_asset_id:
          character.voice_profile.canonical_reference_asset_id ?? "",
        voice_version: character.voice_profile.voice_version,
      },
      {
        speaker: character.name,
        text: shot.shot_data.dialogue,
        emotion: shot.shot_data.emotion,
        delivery: shot.shot_data.delivery,
        pace: shot.shot_data.pace,
        scene_id: shot.scene_id,
      },
    );
    const audio = await putAsset({
      owner_id: series.owner_id,
      series_id: series.id,
      kind: "dialogue_audio",
      bucket: "private-generation",
      mime_type: synthesized.audio.mime_type,
      body: synthesized.audio.bytes,
      metadata: {
        shot_id: shot.id,
        generation_job_id: job.id,
        duration_seconds: synthesized.audio.duration_seconds,
      },
    });
    const alignment = await putAsset({
      owner_id: series.owner_id,
      series_id: series.id,
      kind: "dialogue_alignment",
      bucket: "private-generation",
      mime_type: "application/json",
      body: encodeJson(synthesized.alignment.json),
      metadata: { shot_id: shot.id, generation_job_id: job.id },
    });
    const duration = dramaHooks.allocateDurations({
      wavSeconds: synthesized.audio.duration_seconds,
      route: DIALOGUE_DURATION_WINDOW,
      audioRole: shot.shot_data.audio_role,
      length: episodeLengthFromProfile(series.style_profile),
    });
    store.shots.set(shot.id, {
      ...shot,
      status: "audio_ready",
      shot_data: {
        ...shot.shot_data,
        dialogue_audio_asset_id: audio.id,
        dialogue_alignment_asset_id: alignment.id,
        duration_seconds: duration.duration_seconds,
        needs_reaction_pad: duration.needs_reaction_pad,
        silence_license: duration.needs_reaction_pad ? "post_nuke" : shot.shot_data.silence_license,
      },
    });
    completeSyncJob(job, job.estimated_cost, {
      audio_asset_id: audio.id,
      alignment_asset_id: alignment.id,
      needs_reaction_pad: duration.needs_reaction_pad,
    });
    return { job: store.jobs.get(job.id)!, shot: store.shots.get(shot.id)!, duration };
  }

  /**
   * Real spend for the job that just ran: what the providers reported (or
   * usage-derived) since the reserve, falling back to the estimate only when
   * nothing was metered. The breakdown is kept on the job for the audit trail.
   */
  function meteredActual(fallback: number): { actual: number; breakdown: Record<string, unknown> | null } {
    const taken = ai.meter.take();
    if (taken.usd <= 0) return { actual: fallback, breakdown: null };
    return {
      actual: taken.usd,
      breakdown: {
        metered_usd: taken.usd,
        estimated_usd: fallback,
        entries: taken.entries.map((row) => ({ provider: row.provider, kind: row.kind, usd: row.usd, reported: row.reported, ...(row.usage ?? {}) })),
      },
    };
  }

  function completeSyncJob(job: GenerationJob, estimated: number, result: Record<string, unknown>) {
    const { actual, breakdown } = meteredActual(estimated);
    let current = store.jobs.get(job.id)!;
    current = transitionJob(current, "submitting", iso(clock));
    current = transitionJob(current, "generating", iso(clock));
    current = transitionJob(current, "ingesting", iso(clock));
    current = transitionJob(current, "qc", iso(clock));
    current = transitionJob(current, "completed", iso(clock), {
      actual_cost: actual,
      result_metadata: breakdown ? { ...result, cost_breakdown: breakdown } : result,
    });
    store.jobs.set(job.id, current);
    settle(current, actual);
  }

  function sceneTakeAlreadyPaid(other: Shot): boolean {
    if (other.selected_generation_id) return true;
    return [...store.jobs.values()].some(
      (job) =>
        job.shot_id === other.id &&
        job.job_type === "video" &&
        (isActive(job.status) || job.status === "completed" || job.status === "needs_review"),
    );
  }

  function assertUniqueSceneTakeSpend(current: Shot, episodeId: string) {
    const spoken = Boolean(current.shot_data.dialogue?.trim());
    if (!spoken && !isSceneTake(current.shot_data)) return;
    for (const other of store.shotsForEpisode(episodeId)) {
      if (other.id === current.id) continue;
      const sameTake = isSceneTake(current.shot_data) && isSceneTake(other.shot_data)
        ? sceneTakesShareSpokenBeat(current.shot_data, other.shot_data)
        : Boolean(current.shot_data.dialogue?.trim()) &&
          current.shot_data.dialogue?.trim() === other.shot_data.dialogue?.trim();
      if (!sameTake) continue;
      if (sceneTakeAlreadyPaid(other)) {
        throw new DuplicateSceneTakeError(current.id, other.id);
      }
    }
  }

  async function generateVideo(input: {
    owner_id: string;
    shot_id: string;
    quality?: QualityProfile;
    privacy?: PrivacyProfile;
    forceModel?: string;
    video_tier?: import("./domain.ts").VideoTier;
  }) {
    const { shot, series, episode } = requireShot(input.shot_id, input.owner_id);
    const videoTier = input.video_tier ?? "pro";
    const quality = videoTier === "catalog" ? "economy" : (input.quality ?? "auto");
    const privacy: PrivacyProfile = input.privacy ?? "standard";
    assertStandardOnly(privacy);

    if (
      shot.shot_data.dialogue &&
      !shot.shot_data.dialogue_audio_asset_id &&
      !isSceneTake(shot.shot_data) &&
      !String(VIDEO_ROUTES.dialogue_default.model).includes("seedance")
    ) {
      await generateDialogue({ owner_id: input.owner_id, shot_id: shot.id });
    }
    const live = store.shots.get(shot.id)!;
    assertUniqueSceneTakeSpend(live, episode.id);
    const scene = store.scenes.get(live.scene_id);
    const location = scene?.location || scene?.scene_data.location;

    // Empty establishing wides are cut from the location plate, not generated:
    // the plate has nobody in it by construction and matches the scene's light.
    // A wide never carries an on-camera line: nobody is in it. A line planned on
    // a wide plays as voice-over from the plate take.
    const isWide = live.shot_data.function === "establishing" || live.shot_data.type === "establishing";
    if (isWide && live.shot_data.dialogue && live.shot_data.audio_role !== "offscreen" && !live.shot_data.group_still_asset_id) {
      store.shots.set(live.id, {
        ...live,
        shot_data: {
          ...live.shot_data,
          audio_role: "offscreen",
          speakers_off_camera: live.shot_data.speaker ? [live.shot_data.speaker] : live.shot_data.speakers_off_camera,
          speaker_on_camera: null,
          mouth_visibility_required: false,
        },
      });
    }
    const wideNow = store.shots.get(shot.id)!;
    const emptyWide = isWide && !wideNow.shot_data.group_still_asset_id && !isObjectInsert(wideNow.shot_data);
    if (emptyWide) {
      const fromPlate = await plateTakeForShot(wideNow, series, location);
      if (fromPlate) return fromPlate;
    }
    if (isObjectInsert(wideNow.shot_data) && !isSceneTake(wideNow.shot_data) && !wideNow.shot_data.dialogue) {
      await ensureInsertPlate(wideNow, series.id);
      const insertPlateId = store.shots.get(wideNow.id)?.shot_data.insert_plate_id;
      const insertPlate = insertPlateId ? await assets.get(insertPlateId).catch(() => null) : null;
      const magic = insertPlate?.body.subarray(0, 3) ?? new Uint8Array();
      const realStill =
        Boolean(deps.plateTake) ||
        (magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e) ||
        (magic[0] === 0xff && magic[1] === 0xd8);
      if (insertPlateId && realStill) {
        const fromInsert = await plateTakeForShot(store.shots.get(wideNow.id)!, series, location, {
          plateId: insertPlateId,
          reason: "object insert from still plate",
        });
        if (fromInsert) return fromInsert;
      }
    }
    const pictured = live.shot_data.speaker_on_camera ?? (live.shot_data.audio_role === "offscreen" ? null : live.shot_data.speaker);
    const others = (scene?.scene_data.characters ?? []).filter((name) => !sameName(name, pictured));
    const takeSpeakers = speakersOnShot(live);
    const partner =
      live.shot_data.audio_role === "offscreen"
        ? live.shot_data.speakers_off_camera?.[0] ?? live.shot_data.speaker
        : takeSpeakers.find((name) => !sameName(name, pictured)) ?? others[0] ?? null;
    const sceneNames = isSceneTake(live.shot_data) ? takeSpeakers : [];
    const identityLocks = sceneNames.flatMap((name) => {
      const character = characterBySpeaker(series.id, name);
      return character ? [identityLockLine(character.name, character.appearance_profile)] : [];
    });
    if (isSceneTake(live.shot_data)) {
      const prev = previousSceneTake({
        current: live,
        episodeShots: store.shotsForEpisode(episode.id),
        locationOf: (row) => store.scenes.get(row.scene_id)?.location ?? null,
      });
      const note = prev?.shot_data.continuity?.blocking_note?.trim();
      const startFrom =
        note ||
        live.shot_data.blocking?.start_from ||
        (prev
          ? "They have just finished the last spoken line. Same sides. Same staging. Same prop. Do not reset the room. Do not repeat that line. JOIN CUT: open on a chest-up MCU of the speaker. Do not stack faces. Do not reprint the last frame."
          : null);
      if (startFrom || live.shot_data.blocking) {
        store.shots.set(live.id, {
          ...live,
          shot_data: {
            ...live.shot_data,
            blocking: {
              camera_left: live.shot_data.blocking?.camera_left ?? takeSpeakers[0] ?? null,
              camera_right: live.shot_data.blocking?.camera_right ?? takeSpeakers[1] ?? null,
              prop: live.shot_data.blocking?.prop ?? null,
              left_gesture: live.shot_data.blocking?.left_gesture ?? null,
              right_gesture: live.shot_data.blocking?.right_gesture ?? null,
              start_from: startFrom,
              coverage: live.shot_data.blocking?.coverage,
              pictured: live.shot_data.blocking?.pictured ?? null,
              present: live.shot_data.blocking?.present,
              enters: live.shot_data.blocking?.enters,
              exits: live.shot_data.blocking?.exits,
              upper_frame: live.shot_data.blocking?.upper_frame ?? null,
              staging: live.shot_data.blocking?.staging ?? null,
              anchor: live.shot_data.blocking?.anchor ?? null,
            },
          },
        });
      }
    }
    const prompted = store.shots.get(live.id)!;
    const episodeTakes = store.shotsForEpisode(episode.id);
    const takeIndex = Math.max(0, sceneTakeIndexOf(prompted, episodeTakes));
    const bible = series.story_bible;
    const structure = bible?.episode_structure?.find((row) => row.episode_number === episode.episode_number);
    const genre = seriesGenre(series);
    const priorEpisode = [...store.episodes.values()].find(
      (row) => row.series_id === series.id && row.episode_number === episode.episode_number - 1,
    );
    const priorEpisodeTakes = priorEpisode
      ? store.shotsForEpisode(priorEpisode.id).filter((row) => isSceneTake(row.shot_data))
      : [];
    const prompt = dramaHooks.buildVideoPrompt({
      location,
      locationNote: await locationNoteFor(series.id, location),
      genre,
      shot: prompted,
      partner,
      peopleCount: isSceneTake(prompted.shot_data) ? takeSpeakers.length : allowsTwoShot(prompted.shot_data.function) ? 2 : 1,
      otherNames: isSceneTake(prompted.shot_data) ? takeSpeakers.filter((name) => !sameName(name, pictured)) : others,
      identityLocks,
      roomDescription: roomDescriptionFor(series, location),
      roomGeometry: await roomGeometryFor(series.id, location),
      takeIndex,
      prevLand: isSceneTake(prompted.shot_data)
        ? lastFramingOf(
            episodeTakes
              .filter((row) => isSceneTake(row.shot_data))
              .filter((_, index) => index < takeIndex)
              .map((row) => ({
                script: row.shot_data.scene_script,
                duration: row.shot_data.duration_seconds ?? row.shot_data.duration_hint_seconds ?? 15,
                blocking: row.shot_data.blocking,
              })),
          )
        : null,
      context: isSceneTake(prompted.shot_data)
        ? videoContextBlock({
            title: bible?.title ?? series.title,
            logline: bible?.logline ?? series.description,
            visualStyle: typeof bible?.visual_style?.lighting === "string" ? bible.visual_style.lighting : null,
            episodeNumber: episode.episode_number,
            episodeTitle: episode.title,
            hook: structure?.hook ?? episode.episode_outline?.blocks[0]?.hook,
            conflict: structure?.conflict ?? episode.episode_outline?.blocks[0]?.friction,
            cliffhanger: structure?.cliffhanger,
            genreMotifs: genre ? humanMotifs(playbookFor(genre).visualMotifs) : null,
            characters: bible?.characters,
            priorTakes: episodeTakes
              .filter((row) => isSceneTake(row.shot_data))
              .filter((_, index) => index < takeIndex)
              .map((row) => ({
                scene_script: row.shot_data.scene_script,
                blocking: row.shot_data.blocking,
                blocking_note: row.shot_data.continuity?.blocking_note,
              })),
            priorEpisode: priorEpisode
              ? {
                  number: priorEpisode.episode_number,
                  cliffhanger: bible?.episode_structure?.find((row) => row.episode_number === priorEpisode.episode_number)
                    ?.cliffhanger,
                  last_script: priorEpisodeTakes.at(-1)?.shot_data.scene_script,
                }
              : null,
            thisTake: {
              index: takeIndex,
              scene_script: prompted.shot_data.scene_script,
              present: prompted.shot_data.blocking?.present ?? takeSpeakers,
              prop: prompted.shot_data.blocking?.prop,
            },
          })
        : null,
    });
    await moderate(
      `${prompt}\n${live.shot_data.dialogue ?? ""}`,
      "shot_submit",
      series.id,
      null,
    );

    const fromWav = live.shot_data.duration_seconds;
    const hint = live.shot_data.duration_hint_seconds;
    const silentReaction =
      live.shot_data.audio_role === "silent" &&
      (live.shot_data.function === "reaction" || live.shot_data.function === "listener_hold");
    const provisional = silentReaction
      ? Math.min(3, fromWav ?? hint)
      : Math.max(fromWav ?? 0, hint);
    const padded = Math.min(
      VIDEO_ROUTES.dialogue_default.max_duration_seconds,
      Math.max(provisional, VIDEO_ROUTES.dialogue_default.min_duration_seconds),
    );
    const current: Shot = {
      ...live,
      shot_data: { ...live.shot_data, duration_seconds: padded },
    };
    store.shots.set(current.id, current);

    const forcedModel = input.forceModel ?? process.env.DRAMA_VIDEO_MODEL?.trim();
    const decision = forcedModel
      ? {
          route: Object.values(VIDEO_ROUTES).find((row) => row.model === forcedModel) ?? {
            ...VIDEO_ROUTES.dialogue_default,
            model: forcedModel,
          },
          reason: "forced model",
        }
      : ai.router.selectVideoRoute(current, privacy, quality, videoTier);
    const duration = current.shot_data.duration_seconds ?? padded;

    const estimated = ai.pricing.estimateVideo(decision.route.model, duration);
    const active = [...store.jobs.values()].find(
      (row) =>
        row.shot_id === current.id &&
        row.job_type === "video" &&
        (isBusyVideoJob(row.status) || !isTerminal(row.status)),
    );
    store.shots.set(current.id, { ...store.shots.get(current.id)!, status: "generating" });
    if (active) {
      if (!active.upstream_job_id && active.status === "queued") {
        await submitVideoJob(active);
      }
      return { job: store.jobs.get(active.id)!, route: decision };
    }

    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: episode.id,
      scene_id: current.scene_id,
      shot_id: current.id,
      job_type: "video",
      model: decision.route.model,
      provider: decision.route.provider,
      upstream_job_id: null,
      idempotency_key: `video:${current.id}:${jobAttemptKey(current.id)}`,
      status: "queued",
      request_metadata: {
        reason: decision.reason,
        prompt,
        quality,
        privacy,
        ...generationPrivacyLog({ model: decision.route.model, privacy_profile: privacy }),
      },
      estimated_cost: estimated,
      expected_ready_at: addSeconds(clock, 15),
    });
    reserve(job);
    await submitVideoJob(job);
    return { job: store.jobs.get(job.id)!, route: decision };
  }

  /**
   * Synthesises an establishing take from the scene's location plate and
   * records it like any other take (job, asset, analysis, ledger at zero cost).
   * Returns null when there is no plate or no ffmpeg, so the caller falls back
   * to generation.
   */
  async function plateTakeForShot(
    shot: Shot,
    series: Series,
    location: string | null | undefined,
    opts?: { plateId?: string | null; reason?: string },
  ): Promise<{ job: GenerationJob; route: { route: { model: string; provider: string }; reason: string } } | null> {
    const plateId = opts?.plateId ?? locationRefForScene(series.location_refs ?? {}, location);
    if (!plateId) return null;
    const plate = await assets.get(plateId).catch(() => null);
    if (!plate) return null;
    const seconds = shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds ?? 4;
    const move = plateMoveFor(shot.id);
    const body = await plateFn(plate.body, seconds, move).catch(() => null);
    if (!body) return null;

    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: store.scenes.get(shot.scene_id)?.episode_id ?? null,
      scene_id: shot.scene_id,
      shot_id: shot.id,
      job_type: "video",
      model: "plate/zoompan",
      provider: "local",
      upstream_job_id: null,
      idempotency_key: `video:${shot.id}:plate:${jobAttemptKey(shot.id)}`,
      status: "queued",
      request_metadata: { reason: opts?.reason ?? "empty establishing from location plate", plate_asset_id: plateId, move, first_frame_asset_id: plateId },
      estimated_cost: 0,
      expected_ready_at: iso(clock),
    });
    reserve(job);
    const asset = await putAsset({
      owner_id: series.owner_id,
      series_id: series.id,
      kind: "shot_video",
      bucket: "private-generation",
      mime_type: "video/mp4",
      body,
      metadata: { shot_id: shot.id, generation_job_id: job.id, duration_seconds: seconds, source: "location_plate", move },
    });
    const analysis: TakeAnalysis = {
      version: 2,
      duration_seconds: probeVideoBytes(body).duration_seconds || seconds,
      has_audio: false,
      settle_in_seconds: 0,
      settle_hop_seconds: 0.1,
      settle_diffs: [],
      mouth_open_seconds: null,
      voice_onset_seconds: null,
      sync_lag_ms: null,
      viseme_pad_seconds: 0,
      audio_slip_seconds: 0,
      internal_cut_count: 0,
      second_body: false,
      chest_skin_fraction: null,
      modest_reference_fraction: null,
      sheer_or_bra: false,
      face_similarity: null,
      face_count: 0,
      measured_at: iso(clock),
    };
    const verdict = scoreTake(analysis, { dialogueCu: false, lockedTake: true, expectedFaces: 0 });
    let current = transitionJob(store.jobs.get(job.id)!, "submitting", iso(clock));
    current = transitionJob(current, "generating", iso(clock));
    current = transitionJob(current, "ingesting", iso(clock));
    current = transitionJob(current, "qc", iso(clock));
    current = transitionJob(current, "completed", iso(clock), {
      actual_cost: 0,
      result_metadata: {
        asset_id: asset.id,
        qc: { pass: true, reasons: [] },
        take_analysis: analysis,
        take_score: verdict.score,
        take_blockers: verdict.blockers,
        take_warnings: verdict.warnings,
      },
    });
    store.jobs.set(job.id, current);
    const live = store.shots.get(shot.id)!;
    store.shots.set(live.id, {
      ...live,
      status: "complete",
      selected_generation_id: asset.id,
      shot_data: {
        ...live.shot_data,
        take_analysis: analysis,
        identity_reject: false,
        // A line planned on the wide plays as voice-over from its TTS; otherwise the plate is silent.
        heard_audio: live.shot_data.dialogue && live.shot_data.audio_role === "offscreen" ? "tts" : "silent",
        first_frame_asset_id: plateId,
      },
    });
    settle(current, 0);
    return { job: current, route: { route: { model: "plate/zoompan", provider: "local" }, reason: opts?.reason ?? "empty establishing from location plate" } };
  }

  function jobAttemptKey(shotId: string): number {
    return (
      [...store.jobs.values()].filter((job) => job.shot_id === shotId && job.job_type === "video" && isTerminal(job.status))
        .length + 1
    );
  }

  function recordJobError(job: GenerationJob, message: string): GenerationJob {
    const detail = redactTaskError(message);
    const patch = {
      error_code: detail.slice(0, 180),
      result_metadata: { ...job.result_metadata, submit_error: detail },
    };
    const next = job.status === "failed" || job.status === "cancelled"
      ? { ...job, ...patch, updated_at: iso(clock) }
      : transitionJob(job, "failed", iso(clock), patch);
    store.jobs.set(next.id, next);
    const reserved = reservedForJob(store.ledger, next.id);
    if (next.status === "failed" && reserved > 0) {
      writeLedger({
        owner_id: next.owner_id,
        series_id: next.series_id,
        entry_type: "release",
        amount: reserved,
        generation_job_id: next.id,
        stripe_event_id: null,
        price_snapshot_version: store.priceSnapshotVersion,
      });
    }
    return next;
  }

  async function signedOrSkip(assetId: string): Promise<string | null> {
    try {
      return await assets.getSignedUrl(assetId, SIGNED_URL_TTL_SECONDS);
    } catch {
      return null;
    }
  }

  const sheetCache = new Map<string, { url: string; id: string }>();
  const faceBoxCache = new Map<string, NormalizedFaceBox | null>();

  /**
   * Where the face sits in a locked still. The character sheet stamp puts its
   * marker here: on a full-body plate a fixed marker lands on the chest and the
   * face still reads as a photograph of a real person to the provider.
   */
  async function faceBoxFor(assetId: string, bytes: Uint8Array, mime?: string | null): Promise<NormalizedFaceBox | null> {
    if (faceBoxCache.has(assetId)) return faceBoxCache.get(assetId) ?? null;
    const locate = ai.vision?.locateFace;
    let box: NormalizedFaceBox | null = null;
    if (locate) {
      try {
        const small = await shrinkReference(bytes);
        box = await locate({ image: small?.bytes ?? bytes, imageMime: small?.mime ?? mime ?? "image/png" });
      } catch {
        box = null;
      }
    }
    faceBoxCache.set(assetId, box);
    return box;
  }

  async function sheetStill(input: {
    sourceId: string;
    name: string;
    role: SheetRole;
    seriesId: string;
    strength?: SheetStrength;
  }): Promise<{ url: string; id: string } | null> {
    const strength = input.strength ?? 0;
    const key = `${input.sourceId}:${input.role}:${strength}`;
    const hit = sheetCache.get(key);
    if (hit) return hit;
    const source = await assets.get(input.sourceId).catch(() => null);
    const face = source ? await faceBoxFor(input.sourceId, source.body, source.asset.mime_type) : null;
    const stamped = source
      ? await stampCharacterSheet(source.body, { name: input.name, role: input.role, face, strength })
      : null;
    if (!stamped) {
      const url = await signedOrSkip(input.sourceId);
      return url ? { url, id: input.sourceId } : null;
    }
    const series = store.series.get(input.seriesId);
    const asset = await putAsset({
      owner_id: series?.owner_id ?? "system",
      series_id: input.seriesId,
      kind: "character_reference",
      bucket: "private-character",
      mime_type: "image/png",
      body: stamped,
      metadata: {
        kind: "character_sheet",
        role: input.role,
        source_id: input.sourceId,
        name: input.name,
        strength,
      },
    });
    const url = await signedOrSkip(asset.id);
    if (!url) return null;
    const row = { url, id: asset.id };
    sheetCache.set(key, row);
    return row;
  }

  async function cacheCuOnCharacter(character: Character, assetId: string): Promise<void> {
    const nextRefs = { ...character.visual_reference_asset_ids, cu: assetId };
    store.characters.set(character.id, {
      ...character,
      visual_reference_asset_ids: nextRefs,
      updated_at: iso(clock),
    });
    if (character.actor_id) {
      const actor = store.actors.get(character.actor_id);
      if (actor) {
        store.actors.set(actor.id, {
          ...actor,
          visual_reference_asset_ids: { ...actor.visual_reference_asset_ids, cu: assetId },
          updated_at: iso(clock),
        });
      }
    }
  }

  async function lockedIdentityStill(character: Character): Promise<{ id: string; kind: string } | null> {
    const raw = faceRefsFor(character);
    if (raw.front) {
      const cached = await assets.get(raw.front).catch(() => null);
      if (cached) return { id: raw.front, kind: "front" };
    }
    return ensureCuStill(character);
  }

  function castSeed(seriesId: string, names: string[]): number {
    const key = `${seriesId}:${[...names].sort().join(",")}`;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash & 0x7fffffff;
  }

  async function ensureCuStill(character: Character): Promise<{ id: string; kind: string } | null> {
    const raw = faceRefsFor(character);
    if (raw.cu) {
      const cached = await assets.get(raw.cu).catch(() => null);
      if (cached) {
        return { id: raw.cu, kind: "cu" };
      }
    }
    const refs = { ...raw, cu: undefined };
    const face = preferredCuFace(refs);
    const seed = seedStillForCu(refs);
    if (face && (face.kind === "cu" || face.kind === "mcu")) return face;
    // Labels lie: a "front" still is often a full-body figure. Always derive the
    // CU by locating the face in the best available still and cropping around it.
    const source = face ?? seed;
    if (!source) return null;
    const seedAsset = await assets.get(source.id).catch(() => null);
    if (seedAsset) {
      let faceBox: { x: number; y: number; width: number; height: number } | null = null;
      if (ai.vision?.locateFace) {
        try {
          const small = await shrinkReference(seedAsset.body);
          faceBox = await ai.vision.locateFace({ image: small?.bytes ?? seedAsset.body, imageMime: small?.mime ?? seedAsset.asset.mime_type });
        } catch {
          faceBox = null;
        }
      }
      const cropped = await cropStillToCu(seedAsset.body, faceBox ? null : "full_body", faceBox);
      if (cropped && cropped.byteLength > 2_000) {
        const series = store.series.get(character.series_id);
        const asset = await putAsset({
          owner_id: series?.owner_id ?? character.series_id,
          series_id: character.series_id,
          actor_id: character.actor_id,
          kind: "character_reference",
          bucket: "private-character",
          mime_type: "image/png",
          body: cropped,
          metadata: { kind: "cu", source_kind: source.kind, character_id: character.id, crop_version: CU_CROP_VERSION, face_box: faceBox },
        });
        await cacheCuOnCharacter(store.characters.get(character.id) ?? character, asset.id);
        return { id: asset.id, kind: "cu" };
      }
      try {
        const image = await ai.image.generateReferenceFromSeed({
          characterName: character.name,
          description: appearanceDescription({
            description: character.description,
            ...character.appearance_profile,
          }),
          kind: "cu",
          seed_bytes: seedAsset.body,
          seed_mime_type: seedAsset.asset.mime_type,
        });
        const series = store.series.get(character.series_id);
        const asset = await putAsset({
          owner_id: series?.owner_id ?? character.series_id,
          series_id: character.series_id,
          actor_id: character.actor_id,
          kind: "character_reference",
          bucket: "private-character",
          mime_type: image.mime_type,
          body: image.bytes,
          metadata: { kind: "cu", source_kind: source.kind, character_id: character.id, crop_version: CU_CROP_VERSION },
        });
        await cacheCuOnCharacter(store.characters.get(character.id) ?? character, asset.id);
        return { id: asset.id, kind: "cu" };
      } catch {
        /* fall through to any face still */
      }
    }
    return face ?? (seed && seed.kind !== "full_body" ? seed : null);
  }

  /** Face finder for the mouth probes; absent when no vision engine is configured. */
  function faceLocator(): ((frame: Uint8Array) => Promise<NormalizedFaceBox | null>) | undefined {
    const locate = ai.vision?.locateFace;
    if (!locate) return undefined;
    return async (frame) => {
      const box = await locate({ image: frame, imageMime: "image/jpeg" });
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
  }

  /** Transcript with word timings for speech onset; absent when no STT is configured. */
  function speechTranscriber():
    | ((mp3: Uint8Array) => Promise<{
        text: string;
        speech_onset_seconds: number | null;
        words?: Array<{ word: string; start: number; end: number }>;
      } | null>)
    | undefined {
    const stt = ai.stt;
    if (!stt) return undefined;
    return async (mp3) => {
      const spoken = await stt.transcribe({ bytes: mp3, format: "mp3" });
      return {
        text: spoken.text,
        speech_onset_seconds: spoken.speech_onset_seconds ?? null,
        words: spoken.words ?? [],
      };
    };
  }

  /** Native-take word timings as an alignment track, so captions sit on the spoken word. */
  function alignmentFromTranscript(analysis: TakeAnalysis | null | undefined): AlignmentTrack | null {
    const words = analysis?.transcript_words;
    if (!words?.length) return null;
    return {
      text: analysis?.transcript ?? words.map((row) => row.word).join(" "),
      characters: [],
      words: words.filter((row) => row.word.trim() && Number.isFinite(row.start) && Number.isFinite(row.end)),
    };
  }

  /** Spoken length of a line from its TTS alignment (last character end), if known. */
  function speechSecondsFrom(alignment: AlignmentTrack | null | undefined): number | null {
    const end = alignment?.characters?.at(-1)?.end ?? alignment?.words?.at(-1)?.end;
    return typeof end === "number" && end > 0 ? end : null;
  }

  function seriesGenre(series: Series) {
    return dramaHooks.inferGenre(`${series.title} ${series.description ?? ""} ${series.story_bible?.logline ?? ""}`);
  }

  /** Lighting note the vision model wrote for this location's plate, if any. */
  async function locationNoteFor(seriesId: string, location: string | null | undefined): Promise<string | null> {
    const series = store.series.get(seriesId);
    const plateId = locationRefForScene(series?.location_refs ?? {}, location);
    if (!plateId) return null;
    const plate = (await liveAssetsForSeries(seriesId)).find((asset) => asset.id === plateId);
    const note = plate?.metadata.lighting_lock;
    return typeof note === "string" && note.trim() ? note : null;
  }

  /** Floor-plan note read off the plate by vision, when the plate was described with one. */
  async function roomGeometryFor(seriesId: string, location: string | null | undefined): Promise<string | null> {
    const series = store.series.get(seriesId);
    const plateId = locationRefForScene(series?.location_refs ?? {}, location);
    if (!plateId) return null;
    const plate = (await liveAssetsForSeries(seriesId)).find((asset) => asset.id === plateId);
    const note = plate?.metadata.geometry;
    return typeof note === "string" && note.trim() ? note : null;
  }

  /** "Night delivery driver. Twenty-six. Works doubles…" → "Night delivery driver". Genre convention: label the face when it first appears. */
  function introLabelFor(description: string | null | undefined): string | null {
    const first = (description ?? "").split(/[.!?]\s|\.$/)[0]?.replace(/\([^)]*\)/g, "").trim() ?? "";
    if (!first) return null;
    const words = first.split(/\s+/).filter(Boolean);
    if (words.length > 6 || /\b(engine|wall|witness|nuke)\b/i.test(first)) return null;
    return first.replace(/[.,;:]+$/, "");
  }

  /** The bible's own line for this room ("ESTATE KITCHEN — stone floor, island…"); the writer's floor plan. */
  function roomDescriptionFor(series: Series, location: string | null | undefined): string | null {
    const want = (location ?? "").split(" — ")[0]?.trim().toLowerCase();
    if (!want) return null;
    const rows = series.story_bible?.locations ?? [];
    const hit = rows.find((row) => row.split(" — ")[0]?.trim().toLowerCase() === want) ?? rows.find((row) => row.toLowerCase().includes(want));
    return hit?.trim() || null;
  }

  async function findAssetByMeta(seriesId: string, kind: string, extra?: (meta: Record<string, unknown>) => boolean): Promise<string | null> {
    const listed = await liveAssetsForSeries(seriesId);
    const hit = listed.find((asset) => asset.metadata.kind === kind && (!extra || extra(asset.metadata)));
    return hit?.id ?? null;
  }

  async function lockProps(input: { owner_id: string; series_id: string }) {
    const series = requireSeries(input.series_id, input.owner_id);
    for (const kind of PROP_BIBLE_KINDS) {
      const existing = await findAssetByMeta(series.id, PROP_KIND, (meta) => meta.prop === kind);
      if (existing) continue;
      const image = await ai.image.generateReference({
        characterName: kind,
        description: PROP_PROMPTS[kind],
        kind: "object_insert",
      });
      await putAsset({
        owner_id: series.owner_id,
        series_id: series.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { kind: PROP_KIND, prop: kind, key: propKey(kind) },
      });
    }
  }

  /**
   * One object, generated on demand from the design screen. It is keyed exactly
   * the way the planner keys the same words, so when a shot locks that object
   * the shoot reuses this still instead of inventing the prop a second time.
   */
  async function writeStoryDocument(series: { title: string; description?: string | null; story_bible?: StoryBible | null }, name: string): Promise<WrittenDocument | null> {
    if (!isReadableDocument(name)) return null;
    const parties = (series.story_bible?.characters ?? []).map((row) => row.name).filter(Boolean);
    const input = {
      name,
      title: series.story_bible?.title ?? series.title,
      logline: series.story_bible?.logline ?? series.description ?? "",
      parties,
    };
    if (ai.llm.writeDocument) {
      try {
        return normalizeWrittenDocument(await ai.llm.writeDocument(input), fallbackDocument(input));
      } catch {
        return fallbackDocument(input);
      }
    }
    return fallbackDocument(input);
  }

  async function lockProp(input: { owner_id: string; series_id: string; name: string; force?: boolean }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const parsed = propFromLockText(input.name);
    if (!parsed) throw new Error("Name the object so it can be shot on its own");
    const existing = await findAssetByMeta(series.id, PROP_KIND, (meta) => meta.key === parsed.key);
    const existingMeta = existing
      ? ((await liveAssetsForSeries(series.id)).find((row) => row.id === existing)?.metadata ?? null)
      : null;
    const existingDocument = documentFromMeta(existingMeta);
    const views = objectViews(parsed.name);
    const existingViews = existing ? await listedObjectViews(series.id, existing) : [];
    // A document still without written lines is the old dummy-lettering plate.
    const needsDocument = isReadableDocument(parsed.name) && !existingDocument;
    if (existing && !input.force && existingViews.length >= views.length && !needsDocument) {
      return { asset_id: existing, key: parsed.key, name: parsed.name, state: parsed.state, reused: true };
    }
    const remaining =
      existing && !input.force && !needsDocument ? Math.max(0, views.length - existingViews.length) : 1 + views.length;
    const job = createJob({
      owner_id: series.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/prop-still",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: freshJobKey(`prop:${series.id}:${parsed.key}`),
      status: "queued",
      request_metadata: { prop: parsed.name, key: parsed.key },
      estimated_cost: ai.pricing.estimateImage() * Math.max(1, remaining) + (isReadableDocument(parsed.name) ? ai.pricing.estimateLlm() : 0),
      expected_ready_at: addSeconds(clock, views.length ? 90 : 30),
    });
    reserve(job);
    let stillId = existing && !input.force && !needsDocument ? existing : null;
    let document = existingDocument;
    if (!stillId) {
      document = (await writeStoryDocument(series, parsed.name)) ?? existingDocument;
      const description = document ? documentPrompt(parsed.name, document) : parsed.prompt;
      // A state change ("open") is the sealed object again, not a new object.
      const seedId = parsed.seedKey
        ? await findAssetByMeta(series.id, PROP_KIND, (meta) => meta.key === parsed.seedKey)
        : null;
      const seed = seedId ? await assets.get(seedId).catch(() => null) : null;
      const image = seed
        ? await ai.image.generateReferenceFromSeed({
            characterName: parsed.name,
            description: `${description}. Same object as the attached still, only the state changes.`,
            kind: "object_insert",
            seed_bytes: seed.body,
            seed_mime_type: seed.asset.mime_type,
          })
        : await ai.image.generateReference({
            characterName: parsed.name,
            description,
            kind: "object_insert",
          });
      const kind = inferPropKind(parsed.name);
      const asset = await putAsset({
        owner_id: series.owner_id,
        series_id: series.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        // `prop` carries the cached kind so the generic prop bible reuses this
        // show's own object instead of generating a stock one beside it.
        metadata: {
          kind: PROP_KIND,
          prop: kind ?? parsed.name,
          key: parsed.key,
          state: parsed.state,
          name: parsed.name,
          ...(document ? { document } : {}),
        },
      });
      stillId = asset.id;
    }
    await ensureObjectViews(series.id, parsed.name, stillId, { required: true, document });
    completeSyncJob(job, job.estimated_cost, { key: parsed.key, asset_id: stillId });
    return {
      asset_id: stillId,
      key: parsed.key,
      name: parsed.name,
      state: parsed.state,
      reused: Boolean(existing && !input.force && !needsDocument),
    };
  }

  const ROOM_ANGLE_KIND = "room_angle";
  const ROOM_ANGLE_ATTEMPTS = 3;

  async function listedRoomAngles(
    seriesId: string,
    location: string,
    plateId: string,
  ): Promise<Array<{ id: string; angle: string }>> {
    const listed = await liveAssetsForSeries(seriesId);
    return listed.flatMap((asset) => {
      const meta = asset.metadata ?? {};
      if (meta.kind !== ROOM_ANGLE_KIND || meta.room_pack_version !== ROOM_PACK_VERSION) return [];
      if (meta.location !== location || meta.plate_id !== plateId) return [];
      const angle = typeof meta.angle === "string" ? meta.angle : "";
      return angle ? [{ id: asset.id, angle }] : [];
    });
  }

  async function judgeEmptyPlace(
    image: { bytes: Uint8Array; mime_type: string },
    location: string,
  ): Promise<{ peoplePresent: boolean | null; placeholderLettering: boolean | null; productionGearPresent: boolean | null }> {
    if (!ai.vision?.describeLocation) {
      return { peoplePresent: null, placeholderLettering: null, productionGearPresent: null };
    }
    try {
      const small = await shrinkReference(image.bytes);
      const described = await ai.vision.describeLocation({
        plate: small?.bytes ?? image.bytes,
        plateMime: small?.mime ?? image.mime_type,
        location,
      });
      return {
        peoplePresent: described.people_present,
        placeholderLettering: described.placeholder_lettering,
        productionGearPresent: described.production_gear_present,
      };
    } catch {
      return { peoplePresent: null, placeholderLettering: null, productionGearPresent: null };
    }
  }

  async function judgeRoomContinuity(
    master: { bytes: Uint8Array; mime_type: string },
    layout: { bytes: Uint8Array; mime_type: string } | null,
    candidate: { bytes: Uint8Array; mime_type: string },
    location: string,
    angle: string,
  ): Promise<{ consistent: boolean; camera_correct: boolean; notes: string } | null> {
    if (!ai.vision?.judgePlaceContinuity) return null;
    try {
      const [masterSmall, layoutSmall, candidateSmall] = await Promise.all([
        shrinkReference(master.bytes),
        layout ? shrinkReference(layout.bytes) : Promise.resolve(null),
        shrinkReference(candidate.bytes),
      ]);
      return await ai.vision.judgePlaceContinuity({
        master: masterSmall?.bytes ?? master.bytes,
        masterMime: masterSmall?.mime ?? master.mime_type,
        layout: layout ? layoutSmall?.bytes ?? layout.bytes : null,
        layoutMime: layout ? layoutSmall?.mime ?? layout.mime_type : undefined,
        candidate: candidateSmall?.bytes ?? candidate.bytes,
        candidateMime: candidateSmall?.mime ?? candidate.mime_type,
        location,
        angle,
      });
    } catch {
      return null;
    }
  }

  /**
   * The rest of the empty-set pack, derived from the current plate. Keyed by
   * plate_id so a rebuild cannot keep the old room's walls. At Build the pack
   * is required; during a take a missing view is a weaker lock, not a failed cut.
   */
  async function ensureRoomAngles(
    seriesId: string,
    location: string | null | undefined,
    plateId: string,
    opts: { required?: boolean } = {},
  ): Promise<Array<{ url: string; id: string; angle: string }>> {
    const series = store.series.get(seriesId);
    if (!series || !location) {
      if (opts.required) throw new Error("A location name is required");
      return [];
    }
    const wanted = roomAnglesFor(location);
    // Establish one shared floor plan before asking for any wall view. Each
    // subsequent image receives both the master and this layout.
    const ordered = [...wanted].sort((left, right) =>
      left.angle === "overhead" ? -1 : right.angle === "overhead" ? 1 : 0
    );
    const out: Array<{ url: string; id: string; angle: string }> = [];
    const missing: string[] = [];
    const plate = await assets.get(plateId).catch(() => null);
    if (!plate) {
      if (opts.required) throw new Error(`Could not read the plate for ${location}`);
      return [];
    }
    let layout: { bytes: Uint8Array; mime_type: string } | null = null;
    const existingLayoutId = await findAssetByMeta(
      seriesId,
      ROOM_ANGLE_KIND,
      (meta) =>
        meta.location === location &&
        meta.angle === "overhead" &&
        meta.plate_id === plateId &&
        meta.room_pack_version === ROOM_PACK_VERSION,
    );
    if (existingLayoutId) {
      const existingLayout = await assets.get(existingLayoutId).catch(() => null);
      if (existingLayout) layout = { bytes: existingLayout.body, mime_type: existingLayout.asset.mime_type };
    }
    for (const row of ordered) {
      try {
        let id = await findAssetByMeta(
          seriesId,
          ROOM_ANGLE_KIND,
          (meta) =>
            meta.location === location &&
            meta.angle === row.angle &&
            meta.plate_id === plateId &&
            meta.room_pack_version === ROOM_PACK_VERSION,
        );
        if (!id) {
          let lastError: Error | null = null;
          for (let attempt = 0; attempt < ROOM_ANGLE_ATTEMPTS; attempt += 1) {
            const image = await ai.image.generateReferenceFromSeed({
              characterName: location,
              description: `${row.prompt} ${placeLettering(location)}`,
              kind: "location",
              seed_bytes: plate.body,
              seed_mime_type: plate.asset.mime_type,
              layout_bytes: row.angle === "overhead" ? undefined : layout?.bytes,
              layout_mime_type: row.angle === "overhead" ? undefined : layout?.mime_type,
            });
            const judged = await judgeEmptyPlace(image, location);
            if (judged.peoplePresent) {
              lastError = new Error(`The ${row.angle} view of ${location} still shows a human figure`);
              continue;
            }
            if (judged.placeholderLettering) {
              lastError = new Error(`The ${row.angle} view of ${location} still shows dummy lettering or a leaked prop`);
              continue;
            }
            if (judged.productionGearPresent) {
              lastError = new Error(`The ${row.angle} view of ${location} still shows filmmaking equipment`);
              continue;
            }
            const continuity = await judgeRoomContinuity(
              { bytes: plate.body, mime_type: plate.asset.mime_type },
              row.angle === "overhead" ? null : layout,
              image,
              location,
              row.angle,
            );
            if (ai.vision?.judgePlaceContinuity && !continuity) {
              lastError = new Error(`Could not verify the ${row.angle} view of ${location}`);
              continue;
            }
            if (continuity && (!continuity.consistent || !continuity.camera_correct)) {
              lastError = new Error(
                `The ${row.angle} view of ${location} failed set continuity: ${continuity.notes || "layout or camera direction was wrong"}`,
              );
              continue;
            }
            const asset = await putAsset({
              owner_id: series.owner_id,
              series_id: series.id,
              kind: "character_reference",
              bucket: "private-character",
              mime_type: image.mime_type,
              body: image.bytes,
              metadata: {
                kind: ROOM_ANGLE_KIND,
                location,
                angle: row.angle,
                plate_id: plateId,
                room_pack_version: ROOM_PACK_VERSION,
              },
            });
            id = asset.id;
            if (row.angle === "overhead") layout = { bytes: image.bytes, mime_type: image.mime_type };
            lastError = null;
            break;
          }
          if (!id && lastError) throw lastError;
        }
        const url = id ? await signedOrSkip(id) : null;
        if (url && id) out.push({ url, id, angle: row.angle });
        else missing.push(row.angle);
      } catch (error) {
        if (opts.required) throw error;
        missing.push(row.angle);
      }
    }
    if (opts.required && missing.length) {
      throw new Error(`Could not build the ${missing[0]} view of ${location}`);
    }
    const order = new Map(wanted.map((row, index) => [row.angle, index]));
    return out.sort((left, right) => (order.get(left.angle) ?? 0) - (order.get(right.angle) ?? 0));
  }

  async function listedObjectViews(seriesId: string, stillId: string): Promise<Array<{ id: string; angle: string }>> {
    const listed = await liveAssetsForSeries(seriesId);
    return listed.flatMap((asset) => {
      const meta = asset.metadata ?? {};
      if (meta.kind !== OBJECT_ANGLE_KIND || meta.still_id !== stillId) return [];
      const angle = typeof meta.angle === "string" ? meta.angle : "";
      return angle ? [{ id: asset.id, angle }] : [];
    });
  }

  /**
   * Extra faces of the same object — the back of a letter, the open lid —
   * derived from the hero still so a later insert does not invent a new prop.
   */
  async function ensureObjectViews(
    seriesId: string,
    name: string,
    stillId: string,
    opts: { required?: boolean; document?: WrittenDocument | null } = {},
  ): Promise<Array<{ url: string; id: string; angle: string }>> {
    const series = store.series.get(seriesId);
    const wanted = objectViews(name);
    if (!series || !wanted.length) return [];
    const out: Array<{ url: string; id: string; angle: string }> = [];
    const missing: string[] = [];
    for (const row of wanted) {
      try {
        let id = await findAssetByMeta(
          seriesId,
          OBJECT_ANGLE_KIND,
          (meta) => meta.still_id === stillId && meta.angle === row.angle,
        );
        if (!id) {
          const hero = await assets.get(stillId).catch(() => null);
          if (!hero) {
            if (opts.required) throw new Error(`Could not read the still for ${name}`);
            missing.push(row.angle);
            continue;
          }
          const lettering = opts.document ? documentTypeset(opts.document) : objectLettering(name);
          const image = await ai.image.generateReferenceFromSeed({
            characterName: name,
            description: `${row.prompt}. Same object as the attached still. ${lettering} Object only, no people, no hands. Cinematic still.`,
            kind: "object_insert",
            seed_bytes: hero.body,
            seed_mime_type: hero.asset.mime_type,
          });
          const asset = await putAsset({
            owner_id: series.owner_id,
            series_id: series.id,
            kind: "character_reference",
            bucket: "private-character",
            mime_type: image.mime_type,
            body: image.bytes,
            metadata: { kind: OBJECT_ANGLE_KIND, prop: name, name, angle: row.angle, still_id: stillId },
          });
          id = asset.id;
        }
        const url = await signedOrSkip(id);
        if (url) out.push({ url, id, angle: row.angle });
        else missing.push(row.angle);
      } catch (error) {
        if (opts.required) throw error;
        missing.push(row.angle);
      }
    }
    if (opts.required && missing.length) {
      throw new Error(`Could not build the ${missing[0]} view of ${name}`);
    }
    return out;
  }

  /** A prop still for whatever the planner locked, generated once per identity+state. */
  async function ensurePropStillFromText(seriesId: string, propText: string | null | undefined): Promise<{ url: string; id: string; name: string } | null> {
    const prop = propFromLockText(propText);
    if (!prop) return null;
    try {
      const existing = await findAssetByMeta(seriesId, PROP_KIND, (meta) => meta.key === prop.key);
      if (existing) {
        const url = await signedOrSkip(existing);
        return url ? { url, id: existing, name: prop.name } : null;
      }
      const series = store.series.get(seriesId);
      if (!series) return null;
      const seedId = prop.seedKey ? await findAssetByMeta(seriesId, PROP_KIND, (meta) => meta.key === prop.seedKey) : null;
      const seed = seedId ? await assets.get(seedId).catch(() => null) : null;
      const document = await writeStoryDocument(series, prop.name);
      const description = document ? documentPrompt(prop.name, document) : prop.prompt;
      const image = seed
        ? await ai.image.generateReferenceFromSeed({
            characterName: prop.name,
            description: `${description}. Same object as the attached still, only the state changes.`,
            kind: "object_insert",
            seed_bytes: seed.body,
            seed_mime_type: seed.asset.mime_type,
          })
        : await ai.image.generateReference({ characterName: prop.name, description, kind: "object_insert" });
      const asset = await putAsset({
        owner_id: series.owner_id,
        series_id: series.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { kind: PROP_KIND, prop: prop.name, key: prop.key, state: prop.state, ...(document ? { document } : {}) },
      });
      const url = await signedOrSkip(asset.id);
      return url ? { url, id: asset.id, name: prop.name } : null;
    } catch {
      return null;
    }
  }

  async function ensurePropStill(seriesId: string, kind: PropKind): Promise<{ url: string; id: string; name: string } | null> {
    try {
      const existing = await findAssetByMeta(seriesId, PROP_KIND, (meta) => meta.prop === kind);
      if (existing) {
        const url = await signedOrSkip(existing);
        return url ? { url, id: existing, name: kind } : null;
      }
      const series = store.series.get(seriesId);
      if (!series) return null;
      const image = await ai.image.generateReference({
        characterName: kind,
        description: PROP_PROMPTS[kind],
        kind: "object_insert",
      });
      const asset = await putAsset({
        owner_id: series.owner_id,
        series_id: series.id,
        kind: "character_reference",
        bucket: "private-character",
        mime_type: image.mime_type,
        body: image.bytes,
        metadata: { kind: PROP_KIND, prop: kind, key: propKey(kind) },
      });
      const url = await signedOrSkip(asset.id);
      return url ? { url, id: asset.id, name: kind } : null;
    } catch {
      return null;
    }
  }

  async function ensureInsertPlate(shot: Shot, seriesId: string): Promise<string | null> {
    const cached = shot.shot_data.insert_plate_id;
    if (cached) {
      const existing = await signedOrSkip(cached);
      if (existing) return existing;
    }
    const series = store.series.get(seriesId);
    if (!series) return null;
    const prop = inferPropKind(shot.shot_data.camera) ?? (shot.shot_data.function === "phone_ui" ? "phone" : "letter");
    const reused = await findAssetByMeta(seriesId, PROP_KIND, (meta) => meta.prop === prop);
    if (reused) {
      store.shots.set(shot.id, {
        ...store.shots.get(shot.id)!,
        shot_data: { ...store.shots.get(shot.id)!.shot_data, insert_plate_id: reused },
      });
      return signedOrSkip(reused);
    }
    const kind = shot.shot_data.function === "phone_ui" ? "phone_ui" : "object_insert";
    const genre = seriesGenre(series);
    const image = await ai.image.generateReference({
      characterName: "evidence",
      description: objectPlateCamera(shot.shot_data.function, shot.shot_data.camera, {
        dialogue: shot.shot_data.dialogue,
        motif: evidenceMotif({ camera: shot.shot_data.camera, genreMotifs: genre ? playbookFor(genre).visualMotifs : null }),
      }),
      kind,
    });
    const asset = await putAsset({
      owner_id: series.owner_id,
      series_id: seriesId,
      kind: "character_reference",
      bucket: "private-character",
      mime_type: image.mime_type,
      body: image.bytes,
      metadata: { kind, shot_id: shot.id },
    });
    store.shots.set(shot.id, {
      ...store.shots.get(shot.id)!,
      shot_data: { ...store.shots.get(shot.id)!.shot_data, insert_plate_id: asset.id },
    });
    return signedOrSkip(asset.id);
  }

  async function ensureBlockingStill(input: {
    seriesId: string;
    character: Character;
    location: string;
    framing: ReturnType<typeof blockingFramingFor>;
    locationNote: string | null;
  }): Promise<{ id: string } | null> {
    const key = blockingStillKey(input.character.id, input.location, input.framing);
    const cached = await findAssetByMeta(
      input.seriesId,
      BLOCKING_STILL_KIND,
      (meta) => meta.key === key,
    );
    if (cached) return { id: cached };
    const series = store.series.get(input.seriesId);
    if (!series) return null;
    const cu = await ensureCuStill(input.character);
    const face = cu ? await assets.get(cu.id).catch(() => null) : null;
    const plateId = locationRefForScene(series.location_refs, input.location);
    const plate = plateId ? await assets.get(plateId).catch(() => null) : null;
    if (!plate) return null;
    const framingText =
      input.framing === "reaction"
        ? "Medium close-up from the chest up, more of the room visible, turned three-quarters toward an off-screen partner, listening, not speaking"
        : "Medium close-up from the chest up. Face in the upper third. Shoulders and some of the room visible. Not a face-filling crop.";
    let image: { bytes: Uint8Array; mime_type: string } | null = null;
    try {
      if (BLOCKING_STILL_MODE === "two_ref" && ai.image.generateBlockingStill && face) {
        image = await ai.image.generateBlockingStill({
          characterName: input.character.name,
          description: appearanceDescription({
            description: input.character.description,
            ...input.character.appearance_profile,
          }),
          framing: framingText,
          locationNote: input.locationNote,
          face_bytes: face.body,
          face_mime_type: face.asset.mime_type,
          plate_bytes: plate.body,
          plate_mime_type: plate.asset.mime_type,
        });
      } else if (ai.image.generateBlockingStillFromPlate) {
        image = await ai.image.generateBlockingStillFromPlate({
          characterName: input.character.name,
          description: appearanceDescription({
            description: input.character.description,
            ...input.character.appearance_profile,
          }),
          framing: framingText,
          locationNote: input.locationNote,
          plate_bytes: plate.body,
          plate_mime_type: plate.asset.mime_type,
        });
      }
    } catch {
      return null;
    }
    if (!image) return null;
    if (ai.vision && face) {
      try {
        const smallFace = await shrinkReference(face.body);
        const smallStill = await shrinkReference(image.bytes);
        const judgement = await ai.vision.judgeIdentity({
          reference: smallFace?.bytes ?? face.body,
          referenceMime: smallFace?.mime ?? face.asset.mime_type,
          frames: [smallStill?.bytes ?? image.bytes],
          frameMime: smallStill?.mime ?? image.mime_type,
          expectedFaces: 1,
          description: appearanceDescription({
            description: input.character.description,
            ...input.character.appearance_profile,
          }),
        });
        if (judgement.same_person < BLOCKING_STILL_IDENTITY_MIN || judgement.face_count !== 1) {
          return null;
        }
      } catch {
        return null;
      }
    }
    const asset = await putAsset({
      owner_id: series.owner_id,
      series_id: input.seriesId,
      actor_id: input.character.actor_id,
      kind: "character_reference",
      bucket: "private-character",
      mime_type: image.mime_type,
      body: image.bytes,
      metadata: {
        kind: BLOCKING_STILL_KIND,
        key,
        character_id: input.character.id,
        location: input.location,
        framing: input.framing,
      },
    });
    return { id: asset.id };
  }

  async function visualRefsForShot(
    shot: Shot,
    seriesId: string,
    locationOnly: boolean,
    strip: SceneTakeStrip = "none",
  ): Promise<{
    urls: string[];
    first_frame_kind: ReturnType<typeof firstFrameKind>;
    first_frame_asset_id: string | null;
    labels?: SceneTakeLock[];
    videoUrl?: string | null;
  }> {
    const objectInsert = isObjectInsert(shot.shot_data);
    if (objectInsert) {
      const plate = await ensureInsertPlate(shot, seriesId);
      const plateId = store.shots.get(shot.id)?.shot_data.insert_plate_id ?? null;
      return { urls: plate ? [plate] : [], first_frame_kind: "object", first_frame_asset_id: plateId };
    }
    const scene = store.scenes.get(shot.scene_id);
    const seriesForLoc = store.series.get(seriesId);
    const locIdEarly = locationRefForScene(seriesForLoc?.location_refs ?? {}, scene?.location);
    if (isSceneTake(shot.shot_data) && scene) {
      const names = speakersOnShot(shot);
      if (!names.length) throw new Error("Scene take has no named speakers");
      const packNames = names;
      const people = [];
      // How hard the sheets are stamped is itself a rung of the escalation, so
      // it has to be resolved before the stills are made, not after.
      const rung = strongestStrip(shot.shot_data.scene_take_strip as SceneTakeStrip | undefined, strip);
      const strength = sheetStrengthFor(rung);
      for (const name of packNames) {
        const person = characterBySpeaker(seriesId, name);
        const refs = faceRefsFor(person);
        const frontId = refs.front ?? (await lockedIdentityStill(person))?.id ?? null;
        if (!frontId) throw new Error(`Scene take requires a locked front still for ${name}`);
        const front = await sheetStill({ sourceId: frontId, name, role: "front", seriesId, strength });
        if (!front) throw new Error(`Scene take requires a locked front still for ${name}`);
        // The look this scene wears: the wardrobe state matched to the room
        // (gala dress at the gala, work jacket on the route), generated from
        // the locked face so identity and clothes agree.
        const lookId = wardrobeForScene(person.wardrobe_asset_ids, scene.location);
        // The look goes in stamped like the fronts: Seedance's photoreal
        // classifier rejects an unmarked still as a real person.
        const lookStill = lookId ? await sheetStill({ sourceId: lookId, name, role: "wardrobe", seriesId, strength }) : null;
        people.push({
          name,
          front,
          wardrobe: lookStill ? { url: lookStill.url, id: lookStill.id } : null,
        });
      }
      const locId = locationRefForScene(seriesForLoc?.location_refs ?? {}, scene.location);
      const locUrl = locId && !locationOnly ? await signedOrSkip(locId) : null;
      const propKind =
        inferPropKind(`${shot.shot_data.camera} ${shot.shot_data.scene_script ?? ""} ${shot.shot_data.blocking?.prop ?? ""}`) ??
        null;
      const prop = locationOnly
        ? null
        : (await ensurePropStillFromText(seriesId, shot.shot_data.blocking?.prop)) ??
          (propKind ? await ensurePropStill(seriesId, propKind) : null);
      const angles = locId && !locationOnly ? await ensureRoomAngles(seriesId, scene.location, locId) : [];
      const propAngles =
        prop && !locationOnly ? await ensureObjectViews(seriesId, prop.name, prop.id) : [];
      const pack = buildSceneTakeRefs({
        characters: people,
        locationPlate: locUrl && locId ? { url: locUrl, id: locId } : null,
        locationAngles: angles,
        weldPlate: null,
        propPlate: prop,
        propAngles,
      });
      // A classifier-rejected reference is dropped for this shot. The shot's own
      // strip is a floor, not a lock: the submit loop's escalation still wins, or
      // a pinned shot would resubmit the same rejected pack forever.
      const asked = locationOnly && strip === "none" ? "location" : strip;
      const stripped = applySceneTakeStrip(pack, strongestStrip(rung, asked));
      return {
        urls: stripped.images.map((row) => row.url),
        first_frame_kind: "face",
        first_frame_asset_id: stripped.images[0]?.assetId ?? null,
        labels: stripped.labels.filter((row) => row.role !== "video"),
        videoUrl: null,
      };
    }
    if (locationOnly) return { urls: [], first_frame_kind: "face", first_frame_asset_id: null };
    if (
      shouldUseBlockingStill(shot.shot_data) &&
      !allowsTwoShot(shot.shot_data.function) &&
      shot.shot_data.type !== "establishing"
    ) {
      const pictured =
        shot.shot_data.speaker_on_camera ??
        (shot.shot_data.audio_role === "offscreen" || shot.shot_data.function === "listener_hold"
          ? scene?.scene_data.characters.find((name) => name !== shot.shot_data.speaker) ?? null
          : shot.shot_data.speaker);
      if (pictured) {
        const character = characterBySpeaker(seriesId, pictured);
        const cu = await ensureCuStill(character);
        const faceUrl = cu ? await signedOrSkip(cu.id) : null;
        const sceneShots = store.shotsFor(shot.scene_id);
        const prev = previousContinuityShot({ current: shot, sceneShots });
        const lastId = prev?.shot_data.continuity?.last_frame_asset_id ?? null;
        const lastUrl = lastId ? await signedOrSkip(lastId) : null;
        const blocking = lastUrl
          ? null
          : await ensureBlockingStill({
              seriesId,
              character,
              location: scene?.location ?? "",
              framing: blockingFramingFor(shot.shot_data.function),
              locationNote: await locationNoteFor(seriesId, scene?.location),
            });
        const blockingUrl = blocking ? await signedOrSkip(blocking.id) : null;
        if (lastUrl || blockingUrl) {
          return selectShotRefs({
            lastFrameUrl: lastUrl,
            lastFrameId: lastId,
            blockingUrl,
            blockingId: blocking?.id ?? null,
            faceUrl,
            faceId: cu?.id ?? null,
            faceKind: cu?.kind ?? "cu",
          });
        }
      }
    }
    if (
      (allowsTwoShot(shot.shot_data.function) || shot.shot_data.type === "establishing") &&
      !shot.shot_data.dialogue
    ) {
      const groupId = shot.shot_data.group_still_asset_id ?? null;
      if (shot.shot_data.function === "stacked_two" && !groupId) {
        return { urls: [], first_frame_kind: "face", first_frame_asset_id: null };
      }
      if (groupId) {
        const groupUrl = await signedOrSkip(groupId);
        return {
          urls: groupUrl ? [groupUrl] : [],
          first_frame_kind: "wardrobe",
          first_frame_asset_id: groupId,
        };
      }
      const locUrl = locIdEarly ? await signedOrSkip(locIdEarly) : null;
      return {
        urls: locUrl ? [locUrl] : [],
        first_frame_kind: "wardrobe",
        first_frame_asset_id: locIdEarly,
      };
    }
    const pictured =
      shot.shot_data.speaker_on_camera ??
      (shot.shot_data.audio_role === "offscreen" || shot.shot_data.function === "listener_hold"
        ? scene?.scene_data.characters.find((name) => name !== shot.shot_data.speaker) ?? null
        : shot.shot_data.speaker);
    if (!pictured) return { urls: [], first_frame_kind: "face", first_frame_asset_id: null };
    const character = characterBySpeaker(seriesId, pictured);
    const cu = await ensureCuStill(character);
    const faceOnly = identityRefPolicy === "face_only" || shot.shot_data.function === "button_cu";
    const lookId = faceOnly
      ? null
      : shot.shot_data.look_id ?? wardrobeForScene(character.wardrobe_asset_ids, scene?.location);
    const faceUrl = cu ? await signedOrSkip(cu.id) : null;
    const lookUrl = lookId && lookId !== cu?.id ? await signedOrSkip(lookId) : null;
    const ordered = orderIdentityRefs({
      policy: faceOnly ? "face_only" : identityRefPolicy,
      face: faceUrl && cu ? { url: faceUrl, kind: cu.kind } : null,
      wardrobe: lookUrl && lookId ? { url: lookUrl, kind: "default_wardrobe" } : null,
    });
    const series = store.series.get(seriesId);
    const locId = locationRefForScene(series?.location_refs ?? {}, scene?.location);
    const locUrl = locId ? await signedOrSkip(locId) : null;
    const wide = allowsTwoShot(shot.shot_data.function) || shot.shot_data.type === "establishing";
    const firstAsset =
      wide && locId
        ? locId
        : !faceOnly && identityRefPolicy === "wardrobe_first" && lookId && lookUrl
          ? lookId
          : cu?.id ?? lookId ?? null;
    const urls = wide
      ? [locUrl, ...ordered.urls].filter((url): url is string => Boolean(url))
      : ordered.urls;
    return {
      urls,
      first_frame_kind: wide && locUrl ? "wardrobe" : ordered.first_frame_kind,
      first_frame_asset_id: firstAsset,
    };
  }

  async function submitVideoJob(job: GenerationJob) {
    if (job.status !== "queued") return job;
    try {
      const found = store.shots.get(job.shot_id ?? "");
      if (!found) throw new Error("Shot missing for video submit");
      let shot: Shot = found;
      const refs = await visualRefsForShot(shot, job.series_id, false);
      let visual_reference_urls = refs.urls;
      let frameKind = refs.first_frame_kind;
      let video_reference_url = isSceneTake(shot.shot_data) ? null : refs.videoUrl ?? null;
      const imageLocks = refs.labels ?? [];
      const lockedPrompt = isSceneTake(shot.shot_data) && imageLocks.length
        ? `${String(job.request_metadata.prompt ?? "")} | ${sceneTakeImageLocks(imageLocks, shot.shot_data.blocking)}`
        : String(job.request_metadata.prompt ?? "");
      const seed = isSceneTake(shot.shot_data)
        ? castSeed(
            job.series_id,
            [...new Set(imageLocks.filter((row) => row.role === "front").map((row) => row.name))],
          )
        : undefined;
      const frameQc = firstFrameQc({
        shotFunction: shot.shot_data.function ?? shot.shot_data.type,
        firstFrameKind: frameKind,
        objectInsert: isObjectInsert(shot.shot_data),
        policy: identityRefPolicy,
      });
      const offscreen =
        shot.shot_data.audio_role === "offscreen" || shot.shot_data.function === "listener_hold";
      const audio_reference_url =
        !offscreen && shot.shot_data.dialogue_audio_asset_id
          ? await signedOrSkip(shot.shot_data.dialogue_audio_asset_id)
          : null;
      let current = transitionJob(job, "submitting", iso(clock));
      current = {
        ...current,
        request_metadata: {
          ...current.request_metadata,
          first_frame_kind: frameKind,
          first_frame_qc: frameQc.ok ? "ok" : frameQc.reason,
          first_frame_asset_id: refs.first_frame_asset_id,
          identity_ref_policy:
            identityRefPolicy === "face_only" || shot.shot_data.function === "button_cu"
              ? "face_only"
              : identityRefPolicy,
          extra_ref_count: Math.max(0, visual_reference_urls.length - 1),
          cu_crop_version: CU_CROP_VERSION,
          pictured_name:
            shot.shot_data.speaker_on_camera ??
            (isObjectInsert(shot.shot_data) ? null : shot.shot_data.speaker),
          prompt: lockedPrompt,
          seed,
          seedance_ref_mode:
            String(job.model ?? "").includes("seedance") && visual_reference_urls.length > 0
              ? "input_references"
              : null,
          image_locks: imageLocks,
          video_reference: Boolean(video_reference_url),
        },
      };
      store.jobs.set(job.id, current);
      store.shots.set(shot.id, {
        ...store.shots.get(shot.id)!,
        shot_data: {
          ...store.shots.get(shot.id)!.shot_data,
          first_frame_asset_id: refs.first_frame_asset_id,
        },
      });
      const payload = {
        shot,
        prompt: lockedPrompt,
        visual_reference_urls,
        video_reference_url,
        audio_reference_url,
        duration_seconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
        model: job.model ?? VIDEO_ROUTES.economy_default.model,
        privacy_profile: "standard" as const,
        callback_url: openRouterCallbackUrl(job.callback_token),
        seed,
      };
      let submitted;
      const sceneTake = isSceneTake(shot.shot_data);
      const strips = sceneTake ? SCENE_TAKE_PRIVACY_STRIPS : (["none", "location"] as const);
      // Resume the ladder where a previous submit for this shot got past the
      // classifier; rungs below it are known to fail and cost a round trip each.
      let stripIndex = sceneTake ? Math.max(0, stripRank(shot.shot_data.scene_take_strip)) : 0;
      while (true) {
        try {
          submitted = await ai.video.submit({
            ...payload,
            visual_reference_urls,
            video_reference_url,
          });
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const nextStrip = strips[stripIndex + 1];
          if (process.env.SDM_TRACE) {
            const packed = (current.request_metadata.image_locks ?? imageLocks) as SceneTakeLock[];
            const order = packed.map((row, index) => `${index + 1}:${row.name}/${row.role}`).join(" ");
            process.stderr.write(
              `[strip] ${shot.id} rung ${strips[stripIndex]} refs ${visual_reference_urls.length} [${order}] privacy ${isInputImagePrivacyFailure(message)} next ${nextStrip ?? "none"}\n`,
            );
          }
          if (!isInputImagePrivacyFailure(message) || !nextStrip) {
            throw error;
          }
          stripIndex += 1;
          if (sceneTake) {
            // Remember the rung so the next take of this shot starts here.
            const pinned: Shot = {
              ...shot,
              shot_data: { ...shot.shot_data, scene_take_strip: nextStrip as ShotData["scene_take_strip"] },
            };
            store.shots.set(shot.id, pinned);
            shot = pinned;
          }
          const retry = sceneTake
            ? await visualRefsForShot(shot, job.series_id, false, nextStrip)
            : visual_reference_urls.length > 1
              ? await visualRefsForShot(shot, job.series_id, true)
              : { urls: [] as string[], first_frame_kind: frameKind, labels: [], videoUrl: null };
          if (!sceneTake && retry.urls.length === visual_reference_urls.length && retry.urls.length > 0) {
            throw error;
          }
          visual_reference_urls = retry.urls;
          frameKind = retry.first_frame_kind;
          video_reference_url = sceneTake ? null : retry.videoUrl ?? null;
          const retryLocks = retry.labels ?? [];
          const retryPrompt = sceneTake && retryLocks.length
            ? `${String(job.request_metadata.prompt ?? "")} | ${sceneTakeImageLocks(retryLocks, shot.shot_data.blocking)}`
            : payload.prompt;
          payload.prompt = retryPrompt;
          current = {
            ...current,
            request_metadata: {
              ...current.request_metadata,
              extra_ref_count: Math.max(0, visual_reference_urls.length - 1),
              image_locks: retryLocks.length ? retryLocks : current.request_metadata.image_locks,
              video_reference: Boolean(video_reference_url),
              prompt: retryPrompt,
              seedance_privacy_strip: nextStrip,
            },
          };
          store.jobs.set(job.id, current);
        }
      }
      const existing = store.jobByUpstream(submitted.provider, submitted.upstream_job_id);
      if (existing && existing.id !== job.id) {
        throw new Error("Duplicate upstream job");
      }
      current = transitionJob(current, "generating", iso(clock), {
        provider: submitted.provider,
        model: submitted.model,
        upstream_job_id: submitted.upstream_job_id,
        expected_ready_at: addSeconds(clock, 15),
        request_metadata: { ...current.request_metadata, submitted_at: iso(clock) },
      });
      store.jobs.set(job.id, current);
      return current;
    } catch (error) {
      const latest = store.jobs.get(job.id) ?? job;
      recordJobError(latest, error instanceof Error ? error.message : "video_submit_failed");
      throw error;
    }
  }

  function pendingTooLong(job: GenerationJob): boolean {
    const submittedAt = typeof job.request_metadata.submitted_at === "string" ? job.request_metadata.submitted_at : job.updated_at;
    return clock.now().getTime() - Date.parse(submittedAt) > VIDEO_PENDING_MAX_SECONDS * 1000;
  }

  async function ingestVideoJob(job: GenerationJob) {
    if (!job.upstream_job_id) throw new Error("Job has no upstream id");
    const status = await ai.video.getStatus(job);
    if (status.status !== "completed") {
      const lost = status.status === "pending" && pendingTooLong(job);
      if (status.status === "failed" || status.status === "cancelled" || status.status === "expired" || lost) {
        const failed = transitionJob(job, "failed", iso(clock), {
          error_code: lost ? "pending_timeout" : status.error ?? status.status,
        });
        store.jobs.set(job.id, failed);
        const reserved = reservedForJob(store.ledger, job.id);
        if (reserved > 0) {
          writeLedger({
            owner_id: job.owner_id,
            series_id: job.series_id,
            entry_type: "release",
            amount: reserved,
            generation_job_id: job.id,
            stripe_event_id: null,
            price_snapshot_version: store.priceSnapshotVersion,
          });
        }
        return failed;
      }
      return job;
    }

    let current = job.status === "generating"
      ? transitionJob(job, "ingesting", iso(clock))
      : job;
    store.jobs.set(job.id, current);
    const shot = store.shots.get(job.shot_id ?? "");
    if (!shot) throw new Error("Shot missing for ingest");
    const reused = await existingTakeForJob(current);
    // A take that was fetched before (re-download, replay) but never measured
    // goes through the full pipeline on its stored bytes; only a take that
    // already carries its analysis short-circuits.
    if (reused && current.result_metadata.take_analysis) {
      if (current.result_metadata.asset_id !== reused.id) {
        current = { ...current, result_metadata: { ...current.result_metadata, asset_id: reused.id }, updated_at: iso(clock) };
        store.jobs.set(current.id, current);
      }
      if (current.status === "generating" || current.status === "ingesting") {
        current = current.status === "generating" ? transitionJob(current, "ingesting", iso(clock)) : current;
        store.jobs.set(current.id, current);
        current = transitionJob(current, "qc", iso(clock));
        store.jobs.set(current.id, current);
        const qc = (current.result_metadata.qc as { pass?: boolean; reasons?: string[] } | undefined) ?? {
          pass: true,
          reasons: [],
        };
        const nextStatus = Array.isArray(qc.reasons) && blockingQcReasons(qc.reasons).length > 0
          ? "needs_review"
          : qc.pass === false
            ? "needs_review"
            : "completed";
        current = transitionJob(current, nextStatus, iso(clock), {
          result_metadata: { ...current.result_metadata, asset_id: reused.id, qc },
        });
        store.jobs.set(current.id, current);
      }
      bindShotTake(
        shot,
        reused.id,
        current.status === "needs_review" ? "needs_review" : current.status === "completed" ? "complete" : shot.status,
      );
      return current;
    }
    const scene = store.scenes.get(shot.scene_id);
    const episode = scene ? store.episodes.get(scene.episode_id) : undefined;
    const episodeShots = scene ? store.shotsForEpisode(scene.episode_id) : [shot];
    const shotPosition = episodeShots.findIndex((row) => row.id === shot.id) + 1;
    const stored = reused ? await assets.get(reused.id).catch(() => null) : null;
    const downloaded = stored
      ? { bytes: stored.body, mime_type: stored.asset.mime_type }
      : await ai.video.download(job);
    const asset = stored
      ? stored.asset
      : await putAsset({
          owner_id: job.owner_id,
          series_id: job.series_id,
          kind: "shot_video",
          bucket: "private-generation",
          mime_type: downloaded.mime_type,
          body: downloaded.bytes,
          metadata: {
            shot_id: shot.id,
            generation_job_id: job.id,
            duration_seconds: shot.shot_data.duration_seconds,
            output_url: status.output_url,
            downloaded_via: "openrouter_content",
            episode_number: episode?.episode_number ?? null,
            shot_position: shotPosition > 0 ? shotPosition : shot.position,
            speaker: shot.shot_data.speaker,
          },
        });

    current = transitionJob(store.jobs.get(job.id)!, "qc", iso(clock));
    store.jobs.set(job.id, current);
    const trace = (step: string) => {
      if (process.env.SDM_TRACE) process.stderr.write(`[ingest ${job.id.slice(0, 8)}] ${step} ${new Date().toISOString()}\n`);
    };
    trace("downloaded");
    const alignment = shot.shot_data.dialogue_alignment_asset_id
      ? decodeJson<AlignmentTrack>((await assets.get(shot.shot_data.dialogue_alignment_asset_id))!.body)
      : null;
    let qc = mechanicalQc({
      probe: probeVideoBytes(downloaded.bytes),
      expectedDuration: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
      requireAudio:
        Boolean(shot.shot_data.dialogue) &&
        shot.shot_data.audio_role !== "offscreen" &&
        !isObjectInsert(shot.shot_data),
      expectedDialogue: shot.shot_data.dialogue,
      outputTranscript: alignment ? transcriptFromAlignment(alignment) : null,
      durationToleranceSeconds: QC_AUTOPILOT_DURATION_TOLERANCE_SECONDS,
    });
    const frameHint = current.request_metadata.first_frame_qc;
    if (typeof frameHint === "string" && frameHint !== "ok") {
      qc = { pass: qc.pass, reasons: [...new Set([...qc.reasons, frameHint])] };
    }
    const stillId = current.request_metadata.first_frame_asset_id;
    // Mean-RGB drift is the fallback identity check for deployments without a
    // vision judge; with one, the face judgement below owns identity_drift and
    // invented_people so a lighting change is no longer read as a new person.
    if (typeof stillId === "string" && !isObjectInsert(shot.shot_data) && !ai.vision) {
      const still = await assets.get(stillId).catch(() => null);
      if (still) {
        const stillRgb = await meanRgb(still.body, "image");
        const frameRgb = await meanRgb(downloaded.bytes, "video");
        if (stillRgb && frameRgb) {
          const distance = Math.round(
            Math.sqrt(
              (stillRgb[0] - frameRgb[0]) ** 2 +
                (stillRgb[1] - frameRgb[1]) ** 2 +
                (stillRgb[2] - frameRgb[2]) ** 2,
            ),
          );
          current = {
            ...current,
            request_metadata: {
              ...current.request_metadata,
              identity_rgb_distance: distance,
            },
          };
          store.jobs.set(current.id, current);
          if (identityDrifted(stillRgb, frameRgb, 140)) {
            qc = { pass: false, reasons: [...new Set([...qc.reasons, "identity_drift"])] };
          }
          const emptyRoom =
            (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") &&
            !shot.shot_data.dialogue &&
            !shot.shot_data.group_still_asset_id;
          if (emptyRoom && identityDrifted(stillRgb, frameRgb, 70)) {
            qc = { pass: false, reasons: [...new Set([...qc.reasons, "invented_people"])] };
          }
        }
      }
    }
    const dialogueCu = spokenTakeNeedsMeasure(shot.shot_data);
    const audioConditioned = Boolean(
      shot.shot_data.dialogue &&
        shot.shot_data.audio_role !== "offscreen" &&
        shot.shot_data.audio_role !== "silent" &&
        shot.shot_data.dialogue_audio_asset_id,
    );

    // One measurement pass per take: settle, mouth/voice sync, second body,
    // modesty, and internal cuts (counted after the settle so the I2V morph
    // is not mistaken for a cut). Persisted so the mixer and audits reuse it.
    trace("mechanical qc done");
    const stillBody = typeof stillId === "string" ? (await assets.get(stillId).catch(() => null))?.body ?? null : null;
    const modestId = shot.shot_data.modest_still_asset_id ?? (await modestStillForShot(shot));
    const modestBody = modestId ? (await assets.get(modestId).catch(() => null))?.body ?? null : null;
    trace("stills fetched; measuring take");
    let analysis = await measureTake({
      video: downloaded.bytes,
      still: stillBody,
      modestStill: modestBody,
      dialogueCu,
      wanDialogue: dialogueCu && (job.model ?? "").includes("wan"),
      locateFace: faceLocator(),
      transcribe: speechTranscriber(),
      speechSeconds: speechSecondsFrom(alignment),
    });

    // Identity stage: how many people are in frame, and is it the locked cast
    // member. Empty wides expect 0 faces and need no reference; singles expect 1
    // against the CU still; object inserts are never judged.
    trace("take measured; identity stage");
    const expectedFaces = expectedFacesFor(shot.shot_data);
    if (ai.vision && expectedFaces != null) {
      const pictured = shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker;
      let description: string | null = null;
      if (pictured && expectedFaces === 1) {
        try {
          description = appearanceDescription(characterBySpeaker(job.series_id, pictured));
        } catch {
          description = null;
        }
      }
      const identity = await runIdentityStage({
        video: downloaded.bytes,
        reference: expectedFaces === 1 ? stillBody : null,
        analysis,
        expectedFaces,
        description,
        vision: ai.vision,
      });
      analysis = identity.analysis;
      current = {
        ...current,
        request_metadata: {
          ...current.request_metadata,
          identity_judgement: identity.judgement,
          identity_skipped: identity.skipped,
        },
      };
      store.jobs.set(current.id, current);
    }

    trace("identity done; scoring");
    const sceneTakeIndex = sceneTakeIndexOf(shot, episodeShots);
    const namedCast = store.charactersFor(job.series_id).map((row) => row.name);
    const takeSpeakers = speakersOnShot(shot);
    const verdict = scoreTake(analysis, {
      dialogueCu,
      lockedTake: (shot.shot_data.edit_mode ?? "locked_take") === "locked_take",
      expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
      expectedFaces,
      sceneTake: isSceneTake(shot.shot_data),
      takeIndex: sceneTakeIndex >= 0 ? sceneTakeIndex : 0,
      transcript: analysis.transcript ?? null,
      namedCast,
      speakers: takeSpeakers,
      sceneScript: typeof shot.shot_data.scene_script === "string" ? shot.shot_data.scene_script : null,
    });
    store.shots.set(shot.id, {
      ...store.shots.get(shot.id)!,
      shot_data: {
        ...store.shots.get(shot.id)!.shot_data,
        take_analysis: analysis,
        internal_cut_count: analysis.internal_cut_count,
      },
    });
    current = {
      ...current,
      request_metadata: { ...current.request_metadata, take_score: verdict.score, take_warnings: verdict.warnings },
    };
    store.jobs.set(current.id, current);
    if (verdict.blockers.length) {
      qc = { pass: false, reasons: [...new Set([...qc.reasons, ...verdict.blockers])] };
    }

    trace("scored; stt lane");
    if (ai.stt && (analysis.transcript || shouldSampleDialogueStt(shot, episodeShots))) {
      try {
        // The take analysis already transcribed a dialogue CU for its speech onset.
        const spoken = analysis.transcript
          ? { text: analysis.transcript }
          : await ai.stt.transcribe({ bytes: await extractAudioMp3(downloaded.bytes), format: "mp3" });
        const lane = await chooseHeardLane({
          dialogue: shot.shot_data.dialogue,
          audioRole: shot.shot_data.audio_role,
          hasNativeAudio: true,
          nativeTranscript: spoken.text,
          audioConditioned,
          sceneTake: isSceneTake(shot.shot_data),
        });
        store.shots.set(shot.id, {
          ...store.shots.get(shot.id)!,
          shot_data: {
            ...store.shots.get(shot.id)!.shot_data,
            heard_audio: lane,
          },
        });
        if (isSceneTake(shot.shot_data) && spoken.text) {
          const leaks = nameLeakReasons(spoken.text, {
            namedCast,
            speakers: takeSpeakers,
            script: typeof shot.shot_data.scene_script === "string" ? shot.shot_data.scene_script : null,
          });
          if (leaks.length) qc = { pass: false, reasons: [...new Set([...qc.reasons, ...leaks])] };
        }
        // Native stays even when the transcript drifts (never mux TTS over lips timed
        // to this take), but the drift is now a real QC reason instead of a comment.
        const expected = expectedSpokenText(shot);
        if (expected) {
          const wer = wordErrorRate(expected, spoken.text);
          current = {
            ...current,
            request_metadata: { ...current.request_metadata, native_transcript: spoken.text, native_wer: Number(wer.toFixed(3)) },
          };
          store.jobs.set(current.id, current);
          // Scene takes speak a whole two-person script. STT on overlapping
          // voices will never match a single locked line, so WER is a warning.
          if (isSceneTake(shot.shot_data)) {
            if (wer > 0.15) qc = { pass: qc.pass, reasons: [...new Set([...qc.reasons, "transcript_wer_warn"])] };
          } else if (wer > 0.25) {
            qc = { pass: false, reasons: [...new Set([...qc.reasons, "transcript_wer"])] };
          } else if (wer > 0.15) {
            qc = { pass: qc.pass, reasons: [...new Set([...qc.reasons, "transcript_wer_warn"])] };
          }
        }
      } catch {
        qc = { pass: qc.pass, reasons: [...new Set([...qc.reasons, "stt_sample_failed"])] };
        if (audioConditioned) {
          store.shots.set(shot.id, {
            ...store.shots.get(shot.id)!,
            shot_data: { ...store.shots.get(shot.id)!.shot_data, heard_audio: "native" },
          });
        }
      }
    } else if (audioConditioned) {
      store.shots.set(shot.id, {
        ...store.shots.get(shot.id)!,
        shot_data: { ...store.shots.get(shot.id)!.shot_data, heard_audio: "native" },
      });
    }

    trace("stt done; finalizing take");
    // Takes that can never ship, regardless of review: a stranger, an extra body,
    // sheer wardrobe, a mouth that opens inside the morph, or a mute dialogue CU.
    const dropTake =
      qc.reasons.includes("invented_people") ||
      qc.reasons.includes("modest_dress") ||
      qc.reasons.includes("speaks_before_settle") ||
      qc.reasons.includes("native_audio_missing") ||
      qc.reasons.includes("mouth_leads_voice") ||
      // A judged stranger is dropped outright; only the RGB fallback's drift is
      // soft enough to leave for review on a face shot.
      (qc.reasons.includes("identity_drift") &&
        (analysis.face_similarity != null ||
          ((shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") &&
            !shot.shot_data.dialogue))) ||
      qc.reasons.includes("name_label_spoken") ||
      qc.reasons.includes("name_spoken") ||
      qc.reasons.includes("join_cut_wide") ||
      qc.reasons.includes("measurement_failed") ||
      qc.reasons.includes("speech_unchecked");
    if (dropTake) {
      const live = store.shots.get(shot.id)!;
      store.shots.set(live.id, {
        ...live,
        selected_generation_id: null,
        shot_data: { ...live.shot_data, identity_reject: true },
      });
    }

    // Every take carries its own measurements so the cut can rank all takes of a
    // shot, not just the last one written onto shot_data.
    const takeRecord = {
      asset_id: asset.id,
      qc,
      take_analysis: analysis,
      take_score: verdict.score,
      take_blockers: verdict.blockers,
      take_warnings: verdict.warnings,
    };

    // The take's real cost: the provider's render price plus whatever the
    // identity judge and STT sample metered while ingesting it.
    const sideCosts = ai.meter.take();
    const actualCost = Number(((status.actual_cost ?? job.estimated_cost) + sideCosts.usd).toFixed(4));
    if (sideCosts.usd > 0) {
      current = {
        ...current,
        request_metadata: { ...current.request_metadata, ingest_side_costs: sideCosts.entries.map((row) => ({ kind: row.kind, usd: row.usd })) },
      };
      store.jobs.set(current.id, current);
    }

    const alreadyApproved = (store.shots.get(shot.id)?.shot_data.take_reviews ?? []).some(
      (row) => row.decision === "approve",
    );
    if (blockingQcReasons(qc.reasons).length > 0 || !qc.pass) {
      current = transitionJob(current, "needs_review", iso(clock), {
        result_metadata: takeRecord,
        actual_cost: actualCost,
      });
      store.jobs.set(job.id, current);
      if (!dropTake && !alreadyApproved) bindShotTake(store.shots.get(shot.id)!, asset.id, "needs_review");
      settle(current, actualCost);
      if (dropTake) await autoRegenerateAfterDrop(current, shot);
      return current;
    }

    current = transitionJob(current, "completed", iso(clock), {
      result_metadata: takeRecord,
      actual_cost: actualCost,
    });
    store.jobs.set(job.id, current);
    const accepted = store.shots.get(shot.id)!;
    store.shots.set(accepted.id, {
      ...accepted,
      status: "complete",
      selected_generation_id: asset.id,
      shot_data: { ...accepted.shot_data, identity_reject: false },
    });
    await captureLastFrame(store.shots.get(shot.id)!, downloaded.bytes, analysis.duration_seconds, job);
    settle(current, actualCost);
    return current;
  }

  /**
   * A dropped take (stranger, extra body, sheer wardrobe, speech inside the
   * morph) is not something a reviewer can approve, so spend one more attempt
   * on it right away while retries and budget remain. Budget or cap errors
   * leave the shot in review for a human instead of failing the ingest.
   */
  async function autoRegenerateAfterDrop(job: GenerationJob, shot: Shot) {
    if (!autoRegenerate) return;
    if (isSceneTake(shot.shot_data)) return;
    const terminalAttempts = [...store.jobs.values()].filter(
      (row) => row.shot_id === shot.id && row.job_type === "video" && isTerminal(row.status),
    ).length;
    if (terminalAttempts >= RETRY_CAP) return;
    try {
      const next = await regenerateShot({ owner_id: job.owner_id, shot_id: shot.id });
      store.jobs.set(job.id, {
        ...store.jobs.get(job.id)!,
        result_metadata: { ...store.jobs.get(job.id)!.result_metadata, auto_regenerated_job_id: next.job.id },
        updated_at: iso(clock),
      });
    } catch (error) {
      store.jobs.set(job.id, {
        ...store.jobs.get(job.id)!,
        result_metadata: {
          ...store.jobs.get(job.id)!.result_metadata,
          auto_regenerate_error: redactTaskError(error instanceof Error ? error.message : String(error)),
        },
        updated_at: iso(clock),
      });
    }
  }

  type RankedTake = { assetId: string; job: GenerationJob; analysis: TakeAnalysis | null; verdict: TakeVerdict };

  /** Every live take of a shot that was measured at ingest, with its verdict. */
  async function rankedTakesForShot(shot: Shot, seriesId: string): Promise<RankedTake[]> {
    const live = new Set((await liveAssetsForSeries(seriesId)).map((asset) => asset.id));
    const ranked: RankedTake[] = [];
    for (const job of store.jobs.values()) {
      if (job.shot_id !== shot.id || job.job_type !== "video") continue;
      const meta = job.result_metadata;
      const assetId = meta.asset_id;
      if (typeof assetId !== "string" || !live.has(assetId)) continue;
      if (typeof meta.take_score !== "number" || !Array.isArray(meta.take_blockers)) continue;
      ranked.push({
        assetId,
        job,
        analysis: (meta.take_analysis as TakeAnalysis | undefined) ?? null,
        verdict: {
          score: meta.take_score,
          blockers: meta.take_blockers.filter((row): row is string => typeof row === "string"),
          warnings: Array.isArray(meta.take_warnings)
            ? meta.take_warnings.filter((row): row is string => typeof row === "string")
            : [],
        },
      });
    }
    return ranked;
  }

  function markCallbackUsed(job: GenerationJob) {
    store.jobs.set(job.id, { ...job, callback_token_used: true, updated_at: iso(clock) });
  }

  async function handleOpenRouterWebhook(input: OpenRouterWebhookInput) {
    const job = store.jobByCallbackToken(input.callback_token);
    if (!job || job.callback_token_used) {
      throw new Error("Invalid callback token");
    }
    if (!isActive(job.status) && job.status !== "ingesting") {
      return job;
    }
    if (job.status === "queued") {
      await submitVideoJob(job);
    }
    const latest = store.jobs.get(job.id)!;
    if (!latest.upstream_job_id) {
      return latest;
    }
    const ingested = await ingestVideoJob(latest);
    if (
      ingested.status === "completed" ||
      ingested.status === "needs_review" ||
      ingested.status === "failed" ||
      ingested.status === "cancelled"
    ) {
      markCallbackUsed(ingested);
    }
    return store.jobs.get(ingested.id)!;
  }

  async function handleStripeWebhook(input: StripeWebhookInput) {
    if (!input.signature_valid) {
      throw new Error("Invalid Stripe signature");
    }
    if (hasStripeEvent(store.ledger, input.event_id) || store.stripeEvents.has(input.event_id)) {
      throw new DuplicateStripeEventError(input.event_id);
    }
    if (input.type === "charge.refunded" || input.type === "refund.created") {
      store.stripeEvents.add(input.event_id);
      requireSeries(input.series_id, input.owner_id);
      const unused = projectBalance(store.ledger.filter((row) => row.series_id === input.series_id));
      const debit = Math.min(Math.max(input.amount, 0), Math.max(unused, 0));
      if (debit <= 1e-9) {
        return { ignored: true, reason: "no_unused_budget" };
      }
      const entry = writeLedger({
        owner_id: input.owner_id,
        series_id: input.series_id,
        entry_type: "adjustment",
        amount: -debit,
        generation_job_id: null,
        stripe_event_id: input.event_id,
        price_snapshot_version: store.priceSnapshotVersion || DEFAULT_PRICE_SNAPSHOT_VERSION,
      });
      return { entry };
    }
    if (
      input.type !== "checkout.session.completed" &&
      input.type !== "checkout.session.async_payment_succeeded"
    ) {
      return { ignored: true };
    }
    if (input.payment_status === "unpaid") {
      return { ignored: true };
    }
    store.stripeEvents.add(input.event_id);
    requireSeries(input.series_id, input.owner_id);
    const entry = writeLedger({
      owner_id: input.owner_id,
      series_id: input.series_id,
      entry_type: "purchase",
      amount: input.amount,
      generation_job_id: null,
      stripe_event_id: input.event_id,
      price_snapshot_version: store.priceSnapshotVersion || DEFAULT_PRICE_SNAPSHOT_VERSION,
    });
    return { entry };
  }

  async function applyAdjustment(input: {
    owner_id: string;
    series_id: string;
    amount: number;
    reason?: string;
  }) {
    requireSeries(input.series_id, input.owner_id);
    return writeLedger({
      owner_id: input.owner_id,
      series_id: input.series_id,
      entry_type: "adjustment",
      amount: input.amount,
      generation_job_id: null,
      stripe_event_id: null,
      price_snapshot_version: store.priceSnapshotVersion || DEFAULT_PRICE_SNAPSHOT_VERSION,
    });
  }

  async function tick() {
    const now = clock.now().getTime();
    const due = store.queue.filter((task) => Date.parse(task.visible_at) <= now);
    for (const task of due) {
      const job = store.jobs.get(task.job_id);
      if (!job) {
        store.queue = store.queue.filter((row) => row.id !== task.id);
        continue;
      }
      if (job.job_type === "video") {
        try {
          if (job.status === "queued") {
            await submitVideoJob(job);
          }
          const latest = store.jobs.get(job.id)!;
          if (!latest.upstream_job_id) {
            store.queue = store.queue.filter((row) => row.id !== task.id);
            continue;
          }
          if (latest.status === "generating" || latest.status === "submitting") {
            const after = await ingestVideoJob(latest);
            if (after.status === "generating" || after.status === "submitting") {
              task.visible_at = addSeconds(clock, 15);
              continue;
            }
          }
        } catch {
          store.queue = store.queue.filter((row) => row.id !== task.id);
          continue;
        }
      }
      store.queue = store.queue.filter((row) => row.id !== task.id);
    }
  }

  async function reconcile() {
    const now = clock.now().getTime();
    const recovered: GenerationJob[] = [];
    for (const job of store.jobs.values()) {
      if (!isActive(job.status)) continue;
      if (job.job_type === "video") {
        try {
          if (!job.upstream_job_id && job.status === "queued") {
            await submitVideoJob(job);
          }
          const latest = store.jobs.get(job.id)!;
          if (!latest.upstream_job_id) {
            recovered.push(latest);
            continue;
          }
          if (Date.parse(latest.expected_ready_at) > now) continue;
          recovered.push(await ingestVideoJob(latest));
        } catch {
          recovered.push(store.jobs.get(job.id) ?? job);
        }
      } else if (Date.parse(job.expected_ready_at) > now) {
        continue;
      } else if (job.status === "queued" || job.status === "submitting" || job.status === "generating") {
        const failed = transitionJob(store.jobs.get(job.id)!, "failed", iso(clock), {
          error_code: "reconcile_timeout",
        });
        store.jobs.set(job.id, failed);
        recovered.push(failed);
      }
    }
    return recovered;
  }

  async function liveAssetsForSeries(seriesId: string) {
    return (await assets.listBySeries(seriesId)).filter((asset) => !asset.deleted_at);
  }

  /**
   * A reviewer's decision on a take. Approval pins that take for the cut even
   * if the score prefers another; rejection removes it from consideration. The
   * cut itself is not regenerated — re-render the episode to apply the change.
   */
  async function reviewTake(input: {
    owner_id: string;
    shot_id: string;
    asset_id: string;
    decision: "approve" | "reject";
    note?: string | null;
  }) {
    const { shot, series } = requireShot(input.shot_id, input.owner_id);
    const live = store.shots.get(shot.id)!;
    const known = (await liveAssetsForSeries(series.id)).some((asset) => asset.id === input.asset_id && asset.kind === "shot_video");
    if (!known) throw new Error("Take not found on this series");
    const reviews = (live.shot_data.take_reviews ?? []).filter((row) => row.asset_id !== input.asset_id);
    reviews.push({
      asset_id: input.asset_id,
      decision: input.decision,
      note: input.note?.trim() || null,
      reviewed_at: iso(clock),
      reviewer_id: input.owner_id,
    });
    const rejectedSelected = input.decision === "reject" && live.selected_generation_id === input.asset_id;
    const next: Shot = {
      ...live,
      status: input.decision === "approve" ? "complete" : rejectedSelected ? "needs_review" : live.status,
      selected_generation_id: input.decision === "approve" ? input.asset_id : rejectedSelected ? null : live.selected_generation_id,
      shot_data: {
        ...live.shot_data,
        take_reviews: reviews,
        identity_reject: input.decision === "approve" ? false : live.shot_data.identity_reject,
        heard_audio:
          input.decision === "approve" && isSceneTake(live.shot_data) ? "native" : live.shot_data.heard_audio,
      },
    };
    // The approved take's own measurements drive the manifest for this shot.
    if (input.decision === "approve") {
      const ranked = await rankedTakesForShot(next, series.id);
      const chosen = ranked.find((row) => row.assetId === input.asset_id);
      if (chosen?.analysis) next.shot_data = { ...next.shot_data, take_analysis: chosen.analysis };
      store.shots.set(next.id, next);
      if (!next.shot_data.continuity?.last_frame_asset_id) {
        const take = await assets.get(input.asset_id).catch(() => null);
        const duration = chosen?.analysis?.duration_seconds ?? next.shot_data.duration_seconds ?? next.shot_data.duration_hint_seconds;
        if (take && chosen) await captureLastFrame(next, take.body, duration, chosen.job);
      }
      return store.shots.get(next.id)!;
    }
    store.shots.set(next.id, next);
    return next;
  }

  /**
   * Re-runs the identity judge and scoring on a shot's stored takes. Used after
   * a QC fix so takes that were blocked by a since-corrected check are judged
   * again on the same bytes instead of being regenerated.
   */
  async function rejudgeShot(input: { owner_id: string; shot_id: string }) {
    const { shot, series } = requireShot(input.shot_id, input.owner_id);
    const jobs = [...store.jobs.values()].filter(
      (job) => job.shot_id === shot.id && job.job_type === "video" && typeof job.result_metadata.asset_id === "string",
    );
    const live = new Set((await liveAssetsForSeries(series.id)).map((asset) => asset.id));
    const dialogueCu = spokenTakeNeedsMeasure(shot.shot_data);
    const expectedFaces = expectedFacesFor(shot.shot_data);
    const results: Array<{ job_id: string; before: string[]; after: string[] }> = [];
    for (const job of jobs) {
      const assetId = job.result_metadata.asset_id as string;
      if (!live.has(assetId)) continue;
      const take = await assets.get(assetId).catch(() => null);
      if (!take) continue;
      const stillId = job.request_metadata.first_frame_asset_id;
      const still = typeof stillId === "string" ? (await assets.get(stillId).catch(() => null))?.body ?? null : null;
      // Re-QC measures again: detectors improve, and a stored analysis may predate them.
      let analysis: TakeAnalysis =
        (await measureTake({
          video: take.body,
          still,
          modestStill: (await modestStillForShot(shot).then((id) => (id ? assets.get(id).catch(() => null) : null)))?.body ?? still,
          dialogueCu,
          wanDialogue: dialogueCu && (job.model ?? "").includes("wan"),
          locateFace: faceLocator(),
          transcribe: speechTranscriber(),
          speechSeconds: speechSecondsFrom(
            shot.shot_data.dialogue_alignment_asset_id
              ? await assets.get(shot.shot_data.dialogue_alignment_asset_id).then((row) => (row ? decodeJson<AlignmentTrack>(row.body) : null)).catch(() => null)
              : null,
          ),
        }));
      if (ai.vision && expectedFaces != null) {
        const identity = await runIdentityStage({
          video: take.body,
          reference: expectedFaces === 1 ? still : null,
          analysis,
          expectedFaces,
          vision: ai.vision,
        });
        analysis = identity.analysis;
        store.jobs.set(job.id, {
          ...store.jobs.get(job.id)!,
          request_metadata: { ...job.request_metadata, identity_judgement: identity.judgement, identity_skipped: identity.skipped, rejudged_at: iso(clock) },
        });
      }
      const episodeShots = store.scenes.get(shot.scene_id)
        ? store.shotsForEpisode(store.scenes.get(shot.scene_id)!.episode_id)
        : [shot];
      const sceneTakeIndex = sceneTakeIndexOf(shot, episodeShots);
      const verdict = scoreTake(analysis, {
        dialogueCu,
        lockedTake: (shot.shot_data.edit_mode ?? "locked_take") === "locked_take",
        expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
        expectedFaces,
        sceneTake: isSceneTake(shot.shot_data),
        takeIndex: sceneTakeIndex >= 0 ? sceneTakeIndex : 0,
        transcript: analysis.transcript ?? null,
        namedCast: store.charactersFor(series.id).map((row) => row.name),
        speakers: speakersOnShot(shot),
        sceneScript: typeof shot.shot_data.scene_script === "string" ? shot.shot_data.scene_script : null,
      });
      const before = Array.isArray(job.result_metadata.take_blockers) ? (job.result_metadata.take_blockers as string[]) : [];
      store.jobs.set(job.id, {
        ...store.jobs.get(job.id)!,
        result_metadata: {
          ...store.jobs.get(job.id)!.result_metadata,
          take_analysis: analysis,
          take_score: verdict.score,
          take_blockers: verdict.blockers,
          take_warnings: verdict.warnings,
        },
        updated_at: iso(clock),
      });
      results.push({ job_id: job.id, before, after: verdict.blockers });
    }
    // Let ranking pick the best clean take (or none) with the new verdicts.
    const chosen = await resolveTakeAssetId(store.shots.get(shot.id)!, series.id);
    const current = store.shots.get(shot.id)!;
    // The shot must carry the analysis of the take that will actually be cut.
    // Leaving the old one behind means the mixer reads pre-fix measurements —
    // including the word timings captions are placed on.
    const reranked = await rankedTakesForShot(current, series.id);
    const chosenAnalysis = chosen ? reranked.find((row) => row.assetId === chosen)?.analysis : null;
    store.shots.set(current.id, {
      ...current,
      status: chosen ? "complete" : "needs_review",
      selected_generation_id: chosen,
      shot_data: {
        ...current.shot_data,
        identity_reject: !chosen,
        ...(chosenAnalysis ? { take_analysis: chosenAnalysis } : {}),
      },
    });
    // The side costs of re-judging are real spend on this series.
    const metered = ai.meter.take();
    if (metered.usd > 0) {
      writeLedger({
        owner_id: series.owner_id,
        series_id: series.id,
        entry_type: "settle",
        amount: metered.usd,
        generation_job_id: null,
        stripe_event_id: null,
        price_snapshot_version: store.priceSnapshotVersion,
      });
    }
    return { shot: store.shots.get(shot.id)!, results, chosen };
  }

  function reviewFor(shot: Shot, assetId: string): "approve" | "reject" | null {
    return shot.shot_data.take_reviews?.find((row) => row.asset_id === assetId)?.decision ?? null;
  }

  async function resolveTakeAssetId(shot: Shot, seriesId: string): Promise<string | null> {
    // A reviewer's approval outranks the score; a rejection removes the take.
    const approved = (shot.shot_data.take_reviews ?? []).filter((row) => row.decision === "approve").at(-1);
    if (approved) {
      const live = new Set((await liveAssetsForSeries(seriesId)).map((asset) => asset.id));
      if (live.has(approved.asset_id)) return approved.asset_id;
    }
    // Measured takes are ranked; the best blocker-free one wins even over a
    // previously selected take, and its analysis becomes the shot's so the
    // manifest trims by the settle of the take that actually plays.
    const rejected = new Set((shot.shot_data.take_reviews ?? []).filter((row) => row.decision === "reject").map((row) => row.asset_id));
    const measured = await rankedTakesForShot(shot, seriesId);
    const ranked = measured.filter((row) => !rejected.has(row.assetId));
    if (measured.length && !ranked.length) return null;
    if (ranked.length) {
      const best = pickBestTake(ranked);
      if (best) {
        const live = store.shots.get(shot.id) ?? shot;
        if (live.shot_data.take_analysis?.measured_at !== best.analysis?.measured_at || live.shot_data.identity_reject) {
          store.shots.set(live.id, {
            ...live,
            shot_data: { ...live.shot_data, take_analysis: best.analysis, identity_reject: false },
          });
        }
        return best.assetId;
      }
      // Every measured take is blocked: nothing below may resurrect one of them.
      return null;
    }
    const listed = await liveAssetsForSeries(seriesId);
    const live = new Set(listed.filter((asset) => !rejected.has(asset.id)).map((asset) => asset.id));
    if (shot.selected_generation_id && live.has(shot.selected_generation_id)) {
      return shot.selected_generation_id;
    }
    const jobs = [...store.jobs.values()]
      .filter((job) => job.shot_id === shot.id && job.job_type === "video")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    for (const job of jobs) {
      const assetId = job.result_metadata.asset_id;
      if (typeof assetId === "string" && live.has(assetId)) return assetId;
    }
    const fromFile = listed.find(
      (asset) => asset.kind === "shot_video" && asset.metadata.shot_id === shot.id && !rejected.has(asset.id),
    );
    return fromFile?.id ?? null;
  }

  async function existingTakeForJob(job: GenerationJob) {
    const listed = await liveAssetsForSeries(job.series_id);
    const fromJob = listed.find((asset) => asset.id === job.result_metadata.asset_id);
    if (fromJob) return fromJob;
    return (
      listed.find(
        (asset) => asset.kind === "shot_video" && asset.metadata.generation_job_id === job.id,
      ) ?? null
    );
  }

  async function captureLastFrame(
    shot: Shot,
    video: Uint8Array,
    durationSeconds: number,
    job: GenerationJob,
  ): Promise<void> {
    if (isObjectInsert(shot.shot_data)) return;
    const at = Math.max(0.2, durationSeconds - 0.35);
    let frames: Uint8Array[] = [];
    try {
      frames = await sampleJpegFrames(video, [at]);
    } catch {
      return;
    }
    const frame = frames[0];
    if (!frame || frame.byteLength < 512) return;
    const stored = await putAsset({
      owner_id: job.owner_id,
      series_id: job.series_id,
      kind: "character_reference",
      bucket: "private-generation",
      mime_type: "image/jpeg",
      body: frame,
      metadata: { kind: LAST_FRAME_KIND, shot_id: shot.id, character: shot.shot_data.speaker_on_camera ?? shot.shot_data.speaker },
    });
    const live = store.shots.get(shot.id);
    if (!live) return;
    let blockingNote: string | undefined;
    if (isSceneTake(shot.shot_data) && ai.vision?.describeBlocking) {
      try {
        const names = speakersOnShot(shot);
        blockingNote = await ai.vision.describeBlocking({ frame, names });
      } catch {
        blockingNote = undefined;
      }
    }
    store.shots.set(live.id, {
      ...live,
      shot_data: {
        ...live.shot_data,
        continuity: {
          kind: "weld",
          prev_shot_id: (() => {
            const episodeId = store.scenes.get(live.scene_id)?.episode_id;
            const prevTake = episodeId
              ? previousSceneTake({
                  current: live,
                  episodeShots: store.shotsForEpisode(episodeId),
                  locationOf: (row) => store.scenes.get(row.scene_id)?.location ?? null,
                })
              : null;
            return prevTake?.id ?? previousContinuityShot({ current: live, sceneShots: store.shotsFor(live.scene_id) })?.id;
          })(),
          last_frame_asset_id: stored.id,
          blocking_note: blockingNote,
        },
      },
    });
  }

  function bindShotTake(shot: Shot, assetId: string, status: Shot["status"] = shot.status) {
    store.shots.set(shot.id, {
      ...store.shots.get(shot.id)!,
      status,
      selected_generation_id: assetId,
    });
  }

  async function redownloadTake(job: GenerationJob, shot: Shot): Promise<string | null> {
    try {
      const downloaded = await ai.video.download(job);
      const scene = store.scenes.get(shot.scene_id);
      const episode = scene ? store.episodes.get(scene.episode_id) : undefined;
      const episodeShots = scene ? store.shotsForEpisode(scene.episode_id) : [shot];
      const shotPosition = episodeShots.findIndex((row) => row.id === shot.id) + 1;
      const asset = await putAsset({
        owner_id: job.owner_id,
        series_id: job.series_id,
        kind: "shot_video",
        bucket: "private-generation",
        mime_type: downloaded.mime_type,
        body: downloaded.bytes,
        metadata: {
          shot_id: shot.id,
          generation_job_id: job.id,
          duration_seconds: shot.shot_data.duration_seconds,
          downloaded_via: "openrouter_content",
          episode_number: episode?.episode_number ?? null,
          shot_position: shotPosition > 0 ? shotPosition : shot.position,
          speaker: shot.shot_data.speaker,
        },
      });
      store.jobs.set(job.id, {
        ...job,
        result_metadata: { ...job.result_metadata, asset_id: asset.id },
        updated_at: iso(clock),
      });
      bindShotTake(shot, asset.id);
      return asset.id;
    } catch {
      return null;
    }
  }

  async function recoverTakeAssetId(shot: Shot, seriesId: string): Promise<string | null> {
    const resolved = await resolveTakeAssetId(shot, seriesId);
    if (resolved) {
      if (shot.selected_generation_id !== resolved) bindShotTake(shot, resolved);
      return resolved;
    }
    // A rejected take stays rejected even if its file has to be fetched again.
    const rejected = new Set((shot.shot_data.take_reviews ?? []).filter((row) => row.decision === "reject").map((row) => row.asset_id));
    const jobs = [...store.jobs.values()]
      .filter(
        (job) =>
          job.shot_id === shot.id &&
          job.job_type === "video" &&
          Boolean(job.upstream_job_id) &&
          (job.status === "completed" || job.status === "needs_review") &&
          !(typeof job.result_metadata.asset_id === "string" && rejected.has(job.result_metadata.asset_id)) &&
          !(Array.isArray(job.result_metadata.take_blockers) && job.result_metadata.take_blockers.length > 0),
      )
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    for (const job of jobs) {
      const assetId = await redownloadTake(job, shot);
      if (assetId) return assetId;
    }
    return null;
  }

  async function renderEpisode(input: {
    owner_id: string;
    episode_id: string;
    shot_ids?: string[];
    block_indexes?: number[];
    /**
     * Live scripts may cut around rejected or missing takes. The product path
     * never does: a paying user gets every planned shot or a hard failure.
     */
    allow_partial?: boolean;
    /** Extra aspects re-framed from the accepted 9:16 master. */
    deliverables?: DeliverableAspect[];
  }) {
    const episode = store.episodes.get(input.episode_id);
    if (!episode) throw new Error("Episode not found");
    requireSeries(episode.series_id, input.owner_id);
    const wantedShots = input.shot_ids ? new Set(input.shot_ids) : null;
    const wantedBlocks = input.block_indexes ? new Set(input.block_indexes) : null;
    const shots = store.shotsForEpisode(episode.id).filter((shot) => {
      if (wantedShots && !wantedShots.has(shot.id)) return false;
      if (wantedBlocks && !wantedBlocks.has(shot.shot_data.block_index ?? -1)) return false;
      return true;
    });
    if (!shots.length) throw new Error("No shots in render slice");
    const takes: Array<{ shot: Shot; assetId: string }> = [];
    const missing: string[] = [];
    for (const shot of shots) {
      // Ranking already excludes blocked and rejected takes, so a shot whose
      // last take was dropped still cuts if a clean replacement has landed.
      const assetId = await recoverTakeAssetId(shot, episode.series_id);
      if (!assetId) {
        missing.push(`${shot.id} (${shot.shot_data.identity_reject ? "identity_reject, " : ""}no playable take)`);
        continue;
      }
      takes.push({ shot, assetId });
    }
    if (missing.length && !input.allow_partial) {
      throw new RenderIncompleteError(missing);
    }
    if (!takes.length) {
      throw new RenderIncompleteError(missing.length ? missing : ["no takes"]);
    }

    // Long episodes render per block, and a block whose takes have not changed
    // since the last render is reused byte for byte. The programme is a stream
    // copy of the blocks, so a failure late in a 15-minute cut costs one block.
    const transcribe = ai.stt
      ? async (mp3: Uint8Array) => {
          const spoken = await ai.stt!.transcribe({ bytes: mp3, format: "mp3" });
          return { words: spoken.words ?? [] };
        }
      : undefined;

    // Render, audit, and when the only refusals are lines the conform loop can
    // re-time from the stem measurement, fold the correction into the shots and
    // render again. Only the blocks holding corrected shots re-render.
    let current = takes;
    for (let pass = 0; ; pass += 1) {
      const groups = blockGroups(current);
      const rendered =
        groups.length > 1 && current.length >= blockRenderMinShots
          ? await renderInBlocks(episode, groups, input.owner_id)
          : await renderSlice(episode, current);
      const { manifest, analyses, heardLanes } = rendered;

      // Gate: the same frame audit that shipped lock-v9, on the bytes we are about
      // to call final. The audit JSON is stored either way so reviewers can see
      // why a cut passed or was refused.
      const muxAudit = await audit({
        body: rendered.body,
        dialogueStem: rendered.dialogueStem ?? null,
        manifest,
        analyses,
        heardLanes,
        transcribe,
      });
      if (muxAudit.ship) {
        return await finalizeRender({ input, episode, takes: current, rendered, muxAudit });
      }
      const laneFor = (shotId: string) => heardLanes[current.findIndex((row) => row.shot.id === shotId)] ?? null;

      // When nothing can be re-timed, a native line still off the lips, a
      // line with no voice in its window, or a room still sliding at its
      // deepest settle is a bad take, not a bad cut: reject it so the runner
      // shoots another (the retry cap still bounds this) and report the cut
      // incomplete. Anything else is refused for a human.
      const rejectRefusedTakes = async (): Promise<never | null> => {
        const stillBad = muxAudit.lines.filter((line) => {
          if (line.pass || laneFor(line.shot_id) !== "native") return false;
          const row = current.find((take) => take.shot.id === line.shot_id);
          return !row || !isSceneTake(row.shot.shot_data);
        });
        const unexplained = muxAudit.reasons.filter((reason) => {
          if (reason === "loudness_off_target" || reason === "true_peak_over" || reason === "final_duration_mismatch") return false;
          const [kind, id] = reason.split(":");
          return !((kind === "sync" || kind === "room_morph") && id && stillBad.some((line) => line.shot_id === id));
        });
        if (!stillBad.length || unexplained.length || input.allow_partial) return null;
        const missing: string[] = [];
        for (const line of stillBad) {
          const row = current.find((take) => take.shot.id === line.shot_id);
          if (!row) continue;
          const why = line.voice_onset_s == null ? "no voice in the line's window" : line.settled_open ? "off the lips after conform" : "room still morphing at the open";
          await reviewTake({ owner_id: input.owner_id, shot_id: row.shot.id, asset_id: row.assetId, decision: "reject", note: `mux audit: ${why}` });
          missing.push(`${row.shot.id} (${why})`);
        }
        await putAsset({
          owner_id: input.owner_id,
          series_id: episode.series_id,
          kind: "episode_audit",
          bucket: "private-final",
          mime_type: "application/json",
          body: encodeJson(muxAudit),
          metadata: { episode_id: episode.id, ship: false, reasons: muxAudit.reasons, checksum: rendered.checksum, takes_rejected: missing.length, conform_pass: pass },
        });
        throw new RenderIncompleteError(missing);
      };

      const corrections =
        pass >= CONFORM_MAX_PASSES
          ? []
          : conformCorrections(
              muxAudit,
              current.map((row, index) => ({
                id: row.shot.id,
                analysis: row.shot.shot_data.take_analysis ?? null,
                lane: heardLanes[index] ?? null,
                takeSeconds: row.shot.shot_data.take_analysis?.duration_seconds ?? null,
                sceneTake: isSceneTake(row.shot.shot_data),
              })),
            );
      if (!onlyConformable(muxAudit, corrections)) {
        await rejectRefusedTakes();
        return await finalizeRender({ input, episode, takes: current, rendered, muxAudit });
      }
      await putAsset({
        owner_id: input.owner_id,
        series_id: episode.series_id,
        kind: "episode_audit",
        bucket: "private-final",
        mime_type: "application/json",
        body: encodeJson(muxAudit),
        metadata: { episode_id: episode.id, ship: false, reasons: muxAudit.reasons, checksum: rendered.checksum, conform_pass: pass + 1 },
      });
      for (const correction of corrections) {
        const shot = store.shots.get(correction.shot_id);
        if (!shot) continue;
        store.shots.set(shot.id, {
          ...shot,
          shot_data: { ...shot.shot_data, take_analysis: correction.analysis },
        });
        process.stderr.write(
          `${JSON.stringify({ event: "sync_conform", shot_id: shot.id, reason: correction.reason, delta_seconds: correction.delta_seconds, pass: pass + 1 })}\n`,
        );
      }
      current = current.map((row) => ({ ...row, shot: store.shots.get(row.shot.id) ?? row.shot }));
    }
  }

  /** Takes grouped by block_index in programme order; shots without a block form one group. */
  function blockGroups(takes: Array<{ shot: Shot; assetId: string }>): Array<{ block: number; takes: Array<{ shot: Shot; assetId: string }> }> {
    const byBlock = new Map<number, Array<{ shot: Shot; assetId: string }>>();
    for (const row of takes) {
      const block = row.shot.shot_data.block_index ?? -1;
      const list = byBlock.get(block) ?? [];
      list.push(row);
      byBlock.set(block, list);
    }
    return [...byBlock.entries()].sort((a, b) => a[0] - b[0]).map(([block, rows]) => ({ block, takes: rows }));
  }

  type SliceRender = {
    body: Uint8Array;
    checksum: string;
    vtt: string;
    container: "mp4";
    dialogueStem?: Uint8Array | null;
    manifest: RenderManifest;
    analyses: Array<TakeAnalysis | null>;
    heardLanes: Array<"native" | "tts" | "silent">;
  };

  /** What a block render depends on; identical inputs reuse the stored block. */
  function blockFingerprint(rows: Array<{ shot: Shot; assetId: string }>): string {
    return sha256HexSync(
      stableStringify({
        mixer: MIXER_VERSION,
        rows: rows.map((row) => ({
          shot: row.shot.id,
          take: row.assetId,
          measured: row.shot.shot_data.take_analysis?.measured_at ?? null,
          heard: row.shot.shot_data.heard_audio ?? null,
          alignment: row.shot.shot_data.dialogue_alignment_asset_id ?? null,
          audio: row.shot.shot_data.dialogue_audio_asset_id ?? null,
          silence: row.shot.shot_data.silence_license ?? null,
          role: row.shot.shot_data.audio_role ?? null,
          pad: row.shot.shot_data.take_analysis?.viseme_pad_seconds ?? null,
          skip: row.shot.shot_data.take_analysis?.audio_skip_seconds ?? null,
          settle: row.shot.shot_data.take_analysis?.settle_in_seconds ?? null,
        })),
      }),
    );
  }

  async function renderInBlocks(
    episode: Episode,
    groups: Array<{ block: number; takes: Array<{ shot: Shot; assetId: string }> }>,
    ownerId: string,
  ): Promise<SliceRender> {
    const existing = (await liveAssetsForSeries(episode.series_id)).filter(
      (asset) => asset.kind === "episode_block" && asset.metadata.episode_id === episode.id,
    );
    const pieces: Array<{ body: Uint8Array; dialogueStem: Uint8Array | null; vtt: string; manifest: RenderManifest; analyses: Array<TakeAnalysis | null>; heardLanes: Array<"native" | "tts" | "silent">; seconds: number; reused: boolean }> = [];
    for (const group of groups) {
      const fingerprint = blockFingerprint(group.takes);
      const cached = existing.find((asset) => asset.metadata.block_index === group.block && asset.metadata.fingerprint === fingerprint);
      const stored = cached ? await assets.get(cached.id).catch(() => null) : null;
      if (stored && typeof cached?.metadata.vtt === "string" && cached.metadata.manifest) {
        const seconds = probeVideoBytes(stored.body).duration_seconds;
        const stemId = typeof cached.metadata.dialogue_stem_asset_id === "string" ? cached.metadata.dialogue_stem_asset_id : null;
        const stem = stemId ? await assets.get(stemId).catch(() => null) : null;
        pieces.push({
          body: stored.body,
          dialogueStem: stem?.body ?? null,
          vtt: cached.metadata.vtt,
          manifest: cached.metadata.manifest as RenderManifest,
          analyses: group.takes.map((row) => row.shot.shot_data.take_analysis ?? null),
          heardLanes: (cached.metadata.heard_lanes as Array<"native" | "tts" | "silent">) ?? group.takes.map(() => "silent" as const),
          seconds,
          reused: true,
        });
        continue;
      }
      const slice = await renderSlice(episode, group.takes);
      const seconds = probeVideoBytes(slice.body).duration_seconds;
      const stemAsset = slice.dialogueStem
        ? await putAsset({
            owner_id: ownerId,
            series_id: episode.series_id,
            kind: "episode_block_stem",
            bucket: "private-final",
            mime_type: "audio/wav",
            body: slice.dialogueStem,
            metadata: { episode_id: episode.id, block_index: group.block, fingerprint, stem: "dialogue" },
          })
        : null;
      await putAsset({
        owner_id: ownerId,
        series_id: episode.series_id,
        kind: "episode_block",
        bucket: "private-final",
        mime_type: "video/mp4",
        body: slice.body,
        metadata: {
          episode_id: episode.id,
          block_index: group.block,
          fingerprint,
          checksum: slice.checksum,
          vtt: slice.vtt,
          manifest: slice.manifest,
          heard_lanes: slice.heardLanes,
          seconds,
          dialogue_stem_asset_id: stemAsset?.id ?? null,
        },
      });
      pieces.push({ ...slice, dialogueStem: slice.dialogueStem ?? null, seconds, reused: false });
    }
    const joined = await concat(pieces.map((piece) => piece.body));
    if (!joined) throw new RenderFailedError("block concatenation failed");
    // One loudness pass over the whole programme; per-block normalisation lands low once quiet blocks join.
    const body = (await normalizeProgrammeLoudness(joined, { lufs: LOUDNESS.mixLufs, truePeakDb: LOUDNESS.truePeakDb })).body;
    let offset = 0;
    const offsets = pieces.map((piece) => {
      const at = offset;
      offset += piece.seconds;
      return at;
    });
    // The programme stem is the block stems laid end to end on the same block
    // clock the manifest uses, so an onset measured on it is on the programme clock.
    const dialogueStem = pieces.every((piece) => piece.dialogueStem)
      ? await concatWavSegments(pieces.map((piece) => ({ body: piece.dialogueStem!, seconds: piece.seconds })))
      : null;
    return {
      body,
      dialogueStem,
      checksum: await sha256Hex(body),
      vtt: mergeVtt(pieces.map((piece, index) => ({ vtt: piece.vtt, offsetSeconds: offsets[index]! }))),
      container: "mp4",
      manifest: mergeManifests(episode.id, pieces.map((piece, index) => ({ manifest: piece.manifest, offsetSeconds: offsets[index]! }))),
      analyses: pieces.flatMap((piece) => piece.analyses),
      heardLanes: pieces.flatMap((piece) => piece.heardLanes),
    };
  }

  /** Renders one contiguous run of takes into a mixed, captioned MP4. */
  async function renderSlice(episode: Episode, takes: Array<{ shot: Shot; assetId: string }>): Promise<SliceRender> {
    const playable = takes.map((row) => row.shot);
    const assetByShot = new Map(takes.map((row) => [row.shot.id, row.assetId]));
    const shotBodies: Uint8Array[] = [];
    const takeDuration = new Map<string, number>();
    for (const shot of playable) {
      const row = await assets.get(assetByShot.get(shot.id)!);
      if (!row) throw new Error(`Missing shot asset ${assetByShot.get(shot.id)}`);
      shotBodies.push(row.body);
      const probed = (await probeVideoBytesAsync(row.body)).duration_seconds;
      if (probed > 0) takeDuration.set(shot.id, probed);
    }
    const series = store.series.get(episode.series_id);
    const manifest = dramaHooks.buildRenderManifest({
      episode_id: episode.id,
      shots: playable,
      assetIdFor: (shot) => assetByShot.get(shot.id)!,
      genre: series ? seriesGenre(series) : null,
      sceneFor: (shot) => {
        const scene = store.scenes.get(shot.scene_id);
        return scene ? { location: scene.location || scene.scene_data.location, time: scene.scene_data.time } : null;
      },
      labelFor: (name) => {
        const character = series ? characterBySpeaker(series.id, name) : null;
        return character ? introLabelFor(character.description) : null;
      },
      durationFor: (shot) => {
        const planned = shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds;
        const take = takeDuration.get(shot.id);
        if (isSceneTake(shot.shot_data)) return take ?? planned;
        // The settle trim removes the I2V morph from the head of the take, so the
        // playable picture is what remains after it.
        const settle = shot.shot_data.take_analysis?.settle_in_seconds ?? 0;
        const slip = shot.shot_data.take_analysis?.audio_slip_seconds ?? 0;
        const playable = take != null ? Math.max(0.4, take - settle - slip) : null;
        const licensedSilence =
          !shot.shot_data.dialogue &&
          (shot.shot_data.silence_license === "post_nuke" || shot.shot_data.silence_license === "post_slap");
        // A licensed hold keeps its planned length, but never past the end of the take.
        if (licensedSilence) return playable != null ? Math.min(planned, playable) : planned;
        return playable ?? planned;
      },
    });
    const alignments: Array<AlignmentTrack | null> = [];
    const ttsBodies: Array<Uint8Array | null> = [];
    const nativeAudio: Array<Uint8Array | null> = [];
    const heardLanes: Array<"native" | "tts" | "silent"> = [];
    for (const [index, shot] of playable.entries()) {
      const captionId = shot.shot_data.dialogue_alignment_asset_id;
      if (captionId) {
        const row = await assets.get(captionId);
        if (!row) throw new Error(`Missing caption asset ${captionId}`);
        alignments.push(decodeJson<AlignmentTrack>(row.body));
      } else {
        // Scene takes speak native Seedance audio, so there is no TTS alignment.
        // The ingest transcript's word timings are the only real clock the cut
        // has; without them captions are guessed from word count and drift.
        alignments.push(alignmentFromTranscript(shot.shot_data.take_analysis));
      }
      if (shot.shot_data.dialogue_audio_asset_id) {
        const audio = await assets.get(shot.shot_data.dialogue_audio_asset_id);
        ttsBodies.push(audio?.body ?? null);
      } else {
        ttsBodies.push(null);
      }
      let native: Uint8Array | null = null;
      const sceneTake = isSceneTake(shot.shot_data);
      if ((shot.shot_data.heard_audio === "native" || sceneTake) && shot.shot_data.audio_role !== "offscreen") {
        try {
          native = await extractAudioMp3(shotBodies[index]!);
        } catch {
          native = shotBodies[index] ?? null;
        }
      }
      nativeAudio.push(native);
      const audioConditioned = Boolean(
        shot.shot_data.dialogue &&
          shot.shot_data.dialogue_audio_asset_id &&
          shot.shot_data.audio_role !== "offscreen" &&
          shot.shot_data.audio_role !== "silent",
      );
      // An off-screen line is always the TTS lane: the listener take's own track
      // is room tone at best, and a listener never speaks the line.
      // Scene takes always keep Seedance's spoken track — there is no TTS to mux.
      heardLanes.push(
        shot.shot_data.audio_role === "silent" || !shot.shot_data.dialogue
          ? "silent"
          : shot.shot_data.audio_role === "offscreen"
            ? "tts"
            : native || sceneTake
              ? "native"
              : audioConditioned
                ? "silent"
                : "tts",
      );
    }
    // Measured at ingest: pad only where the voice really led the mouth, and hand
    // the mixer the probed onsets so it never re-guesses them from a Wan default.
    const analyses = playable.map((shot) => shot.shot_data.take_analysis ?? null);
    const rendered = await render({
      manifest,
      shotBodies,
      alignments,
      ttsBodies,
      nativeAudio,
      heardLanes,
      visemePadSeconds: playable.map((shot, index) =>
        isSceneTake(shot.shot_data) ? 0 : analyses[index] ? analyses[index]!.viseme_pad_seconds : null,
      ),
      visemeMouthOpenSeconds: analyses.map((row) => row?.mouth_open_seconds ?? null),
      visemeVoiceOnsetSeconds: analyses.map((row) => row?.voice_onset_seconds ?? null),
      lockedNative: playable.map((shot) => isSceneTake(shot.shot_data)),
    });
    return { ...rendered, manifest, analyses, heardLanes };
  }

  async function finalizeRender(args: {
    input: { owner_id: string; deliverables?: DeliverableAspect[] };
    episode: Episode;
    takes: Array<{ shot: Shot; assetId: string }>;
    rendered: SliceRender;
    muxAudit: Awaited<ReturnType<MuxAuditFn>>;
  }) {
    const { input, episode, takes, rendered, muxAudit } = args;
    const { manifest } = rendered;
    const auditAsset = await putAsset({
      owner_id: input.owner_id,
      series_id: episode.series_id,
      kind: "episode_audit",
      bucket: "private-final",
      mime_type: "application/json",
      body: encodeJson(muxAudit),
      metadata: { episode_id: episode.id, ship: muxAudit.ship, reasons: muxAudit.reasons, checksum: rendered.checksum },
    });
    const sceneTakeCut = takes.length > 0 && takes.every((take) => isSceneTake(take.shot.shot_data));
    const blockingReasons = muxAudit.reasons.filter((reason) => {
      if (
        sceneTakeCut &&
        (reason === "loudness_off_target" || reason === "true_peak_over" || reason === "black_frames")
      ) {
        return false;
      }
      const [kind, id] = reason.split(":");
      if (kind !== "sync" && kind !== "room_morph") return true;
      const row = takes.find((take) => take.shot.id === id);
      return !row || !isSceneTake(row.shot.shot_data);
    });
    if (blockingReasons.length) {
      store.episodes.set(episode.id, {
        ...episode,
        render_manifest: manifest,
        status: "needs_review",
        updated_at: iso(clock),
      });
      throw new RenderFailedError(`mux audit refused the cut (${blockingReasons.join(", ")}); audit ${auditAsset.id}`);
    }

    // Versioned finals: a re-render never overwrites; each accepted cut gets the
    // next version and the previous stays addressable for a reviewer.
    const version = (episode.render_version ?? 0) + 1;
    const finalAsset = await putAsset({
      owner_id: input.owner_id,
      series_id: episode.series_id,
      kind: "episode_final",
      bucket: "private-final",
      mime_type: "video/mp4",
      body: rendered.body,
      metadata: {
        episode_id: episode.id,
        checksum: rendered.checksum,
        audit_asset_id: auditAsset.id,
        version,
        aspect: "9:16",
        manifest_fingerprint: await sha256Hex(new TextEncoder().encode(manifestFingerprint(manifest))),
      },
    });

    // Caption sidecar (SubRip) so the same cues ship with the file.
    const captionAsset = await putAsset({
      owner_id: input.owner_id,
      series_id: episode.series_id,
      kind: "episode_captions",
      bucket: "private-final",
      mime_type: "application/x-subrip",
      body: new TextEncoder().encode(cuesToSrt(cuesFromVtt(rendered.vtt))),
      metadata: { episode_id: episode.id, version, final_asset_id: finalAsset.id, format: "srt" },
    });

    // Dialogue stem: the studio deliverable a dub, a re-mix or a localisation starts from.
    if (rendered.dialogueStem) {
      await putAsset({
        owner_id: input.owner_id,
        series_id: episode.series_id,
        kind: "episode_stem",
        bucket: "private-final",
        mime_type: "audio/wav",
        body: rendered.dialogueStem,
        metadata: { episode_id: episode.id, version, final_asset_id: finalAsset.id, stem: "dialogue" },
      });
    }

    // Additional aspects are re-frames of the accepted master, never separate cuts.
    const deliverables: Array<{ aspect: DeliverableAspect; asset_id: string; checksum: string }> = [
      { aspect: "9:16", asset_id: finalAsset.id, checksum: rendered.checksum },
    ];
    for (const aspect of input.deliverables ?? []) {
      if (aspect === "9:16") continue;
      const reframed = await reframe(rendered.body, aspect);
      if (!reframed) continue;
      const checksum = await sha256Hex(reframed);
      const asset = await putAsset({
        owner_id: input.owner_id,
        series_id: episode.series_id,
        kind: "episode_final",
        bucket: "private-final",
        mime_type: "video/mp4",
        body: reframed,
        metadata: { episode_id: episode.id, checksum, version, aspect, master_asset_id: finalAsset.id, audit_asset_id: auditAsset.id },
      });
      deliverables.push({ aspect, asset_id: asset.id, checksum });
    }

    // Provenance: everything a studio needs to know how these pixels were made.
    const provenance = buildProvenance({
      episode,
      series: store.series.get(episode.series_id) ?? null,
      version,
      manifest,
      takes: takes.map((row) => ({ shot: row.shot, assetId: row.assetId })),
      finalChecksum: rendered.checksum,
      auditAssetId: auditAsset.id,
      captionAssetId: captionAsset.id,
      deliverables,
    });
    const provenanceAsset = await putAsset({
      owner_id: input.owner_id,
      series_id: episode.series_id,
      kind: "episode_provenance",
      bucket: "private-final",
      mime_type: "application/json",
      body: encodeJson(provenance),
      metadata: { episode_id: episode.id, version, final_asset_id: finalAsset.id },
    });

    for (const row of takes) {
      store.shots.set(row.shot.id, {
        ...row.shot,
        status: "complete",
        selected_generation_id: row.assetId,
      });
    }
    const next = {
      ...episode,
      render_manifest: manifest,
      render_version: version,
      status: "complete" as const,
      updated_at: iso(clock),
    };
    store.episodes.set(episode.id, next);
    return {
      episode: next,
      asset: finalAsset,
      checksum: rendered.checksum,
      vtt: rendered.vtt,
      container: rendered.container,
      version,
      captions_asset_id: captionAsset.id,
      provenance_asset_id: provenanceAsset.id,
      deliverables,
    };
  }

  /** Machine-readable record of how a final was made: models, takes, measurements, gates. */
  function buildProvenance(input: {
    episode: Episode;
    series: Series | null;
    version: number;
    manifest: RenderManifest;
    takes: Array<{ shot: Shot; assetId: string }>;
    finalChecksum: string;
    auditAssetId: string;
    captionAssetId: string;
    deliverables: Array<{ aspect: DeliverableAspect; asset_id: string; checksum: string }>;
  }) {
    const jobsByAsset = new Map<string, GenerationJob>();
    for (const job of store.jobs.values()) {
      const assetId = job.result_metadata.asset_id;
      if (job.job_type === "video" && typeof assetId === "string") jobsByAsset.set(assetId, job);
    }
    return {
      schema: "shortdramamaker/provenance@1",
      generated_at: iso(clock),
      engine: { price_snapshot_version: store.priceSnapshotVersion, identity_ref_policy: identityRefPolicy },
      series: input.series ? { id: input.series.id, title: input.series.title } : null,
      episode: { id: input.episode.id, number: input.episode.episode_number, title: input.episode.title, version: input.version },
      final: { checksum: input.finalChecksum, audit_asset_id: input.auditAssetId, captions_asset_id: input.captionAssetId, deliverables: input.deliverables },
      shots: input.takes.map(({ shot, assetId }) => {
        const job = jobsByAsset.get(assetId);
        const clip = input.manifest.shots.find((row) => row.shot_id === shot.id);
        return {
          shot_id: shot.id,
          position: shot.position,
          function: shot.shot_data.function ?? shot.shot_data.type,
          speaker: shot.shot_data.speaker ?? null,
          take_asset_id: assetId,
          generation_job_id: job?.id ?? null,
          model: job?.model ?? null,
          provider: job?.provider ?? null,
          prompt_sha256: typeof job?.request_metadata.prompt === "string" ? sha256HexSync(job.request_metadata.prompt) : null,
          first_frame_asset_id: job?.request_metadata.first_frame_asset_id ?? shot.shot_data.first_frame_asset_id ?? null,
          heard_audio: shot.shot_data.heard_audio ?? null,
          in_point_seconds: clip?.in_point_seconds ?? null,
          out_point_seconds: clip?.out_point_seconds ?? null,
          take_analysis: shot.shot_data.take_analysis ?? null,
          take_score: typeof job?.result_metadata.take_score === "number" ? job.result_metadata.take_score : null,
          identity: job?.request_metadata.identity_judgement ?? null,
          actual_cost: job?.actual_cost ?? null,
        };
      }),
      moderation: store.moderation.filter((row) => row.series_id === input.episode.series_id).map((row) => ({ checkpoint: row.checkpoint, verdict: row.verdict, at: row.created_at })),
    };
  }

  /**
   * Keeps the buyer's original script. Only the asset id lands on the series, so
   * every advance tick does not drag 80k of text through the store.
   */
  async function attachSourceScript(input: { owner_id: string; series_id: string; text: string }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const text = input.text.trim();
    if (!text) return series;
    const asset = await putAsset({
      owner_id: input.owner_id,
      series_id: series.id,
      kind: "script",
      bucket: "private-source",
      mime_type: "text/plain",
      body: new TextEncoder().encode(text),
      metadata: { series_id: series.id, characters: text.length },
    });
    store.series.set(series.id, {
      ...series,
      style_profile: { ...series.style_profile, source_script_asset_id: asset.id },
    });
    return store.series.get(series.id)!;
  }

  /** Characters of uploaded script sent to the segmenter in one pass. */
  const SEGMENT_SCRIPT_MAX_CHARS = 120_000;

  /**
   * Cuts the buyer's uploaded script into one entry per ordered episode so
   * `planEpisode` adapts their scenes instead of inventing a season from a logline.
   */
  async function segmentSourceScript(input: { owner_id: string; series_id: string; episode_count?: number }) {
    const series = requireSeries(input.series_id, input.owner_id);
    const bible = series.story_bible;
    if (!bible) throw new Error("Segment the script after the story bible exists");
    if (bible.source === "script") return series;

    const assetId = series.style_profile?.source_script_asset_id;
    if (typeof assetId !== "string" || !assetId) return series;
    if (!ai.llm.segmentScript) return series;

    const stored = await assets.get(assetId);
    if (!stored) throw new Error("The uploaded script is no longer in storage");
    const script = new TextDecoder().decode(stored.body).slice(0, SEGMENT_SCRIPT_MAX_CHARS);

    const episodeCount = Math.max(1, input.episode_count || series.target_episode_count || 30);
    const episode_structure = await ai.llm.segmentScript({ bible, script, episodeCount });

    const segmented: StoryBible = { ...bible, episode_structure, source: "script" };
    // Rebuild the season log so it follows the author, not the genre spine.
    const next: StoryBible = {
      ...segmented,
      season: assertSeasonBible(buildSeasonBible({ ...segmented, season: undefined })),
    };
    store.series.set(series.id, { ...series, story_bible: next });
    return store.series.get(series.id)!;
  }

  /**
   * Stores a cover the buyer uploaded at commission time. Runs before any cast
   * work, so `generateSeriesCover` sees `cover_asset_id` already set and skips.
   */
  async function attachSeriesCover(input: {
    owner_id: string;
    series_id: string;
    bytes: Uint8Array;
    mime_type?: string;
  }) {
    const series = requireSeries(input.series_id, input.owner_id);
    if (!input.bytes.length) return series;
    const asset = await putAsset({
      owner_id: input.owner_id,
      series_id: series.id,
      kind: "series_cover",
      bucket: "private-generation",
      mime_type: input.mime_type || "image/jpeg",
      body: input.bytes,
      metadata: { series_id: series.id, title: series.title, source: "upload" },
    });
    store.series.set(series.id, { ...series, cover_asset_id: asset.id });
    return store.series.get(series.id)!;
  }

  async function generateSeriesCover(input: { owner_id: string; series_id: string }) {
    const series = requireSeries(input.series_id, input.owner_id);
    if (series.cover_asset_id) return series;
    const existing = findJobByKey(`cover:${series.id}`);
    const savedId = existing?.result_metadata.cover_asset_id;
    if (typeof savedId === "string" && savedId) {
      store.series.set(series.id, { ...series, cover_asset_id: savedId });
      return store.series.get(series.id)!;
    }
    const job = createJob({
      owner_id: input.owner_id,
      series_id: series.id,
      episode_id: null,
      scene_id: null,
      shot_id: null,
      job_type: "image",
      model: "image/series-cover",
      provider: "openrouter",
      upstream_job_id: null,
      idempotency_key: `cover:${series.id}`,
      status: "queued",
      request_metadata: { series_id: series.id },
      estimated_cost: ai.pricing.estimateImage(),
      expected_ready_at: addSeconds(clock, 25),
    });
    if (job.status === "completed") {
      const coverId = job.result_metadata.cover_asset_id;
      if (typeof coverId === "string") {
        store.series.set(series.id, { ...series, cover_asset_id: coverId });
      }
      return store.series.get(series.id)!;
    }
    if (!reservedForJob(store.ledger, job.id)) reserve(job);
    const lead = store.charactersFor(series.id)[0];
    const logline = series.story_bible?.logline ?? series.description;
    const image = await (ai.image.generateCover
      ? ai.image.generateCover({ title: series.title, logline, characterHint: lead?.description })
      : ai.image.generateReference({
          characterName: series.title,
          description: `${logline} ${lead?.description ?? ""}`.trim(),
          kind: "dramatic vertical series key art, no title text, cinematic lighting",
        }));
    const asset = await putAsset({
      owner_id: input.owner_id,
      series_id: series.id,
      kind: "series_cover",
      bucket: "private-generation",
      mime_type: image.mime_type,
      body: image.bytes,
      metadata: { series_id: series.id, title: series.title },
    });
    store.series.set(series.id, { ...series, cover_asset_id: asset.id });
    completeSyncJob(job, job.estimated_cost, { cover_asset_id: asset.id });
    return store.series.get(series.id)!;
  }

  /**
   * A line that keeps producing unshippable takes is a writing problem, not a
   * dice problem. Revising the line resets the shot: new TTS, new alignment,
   * a fresh retry budget, and any rejection from the old line cleared.
   */
  async function reviseLine(input: { owner_id: string; shot_id: string; dialogue: string }) {
    const { shot, series } = requireShot(input.shot_id, input.owner_id);
    const dialogue = input.dialogue.replace(/\s+/g, " ").trim();
    if (!dialogue) throw new Error("A revised line cannot be empty");
    if (dialogue.split(" ").length > 14) throw new Error("A revised line must be 14 words or fewer");
    await moderate(dialogue, "shot_submit", series.id, null);
    const revised: Shot = {
      ...shot,
      status: "planned",
      selected_generation_id: null,
      shot_data: {
        ...shot.shot_data,
        dialogue,
        dialogue_audio_asset_id: null,
        dialogue_alignment_asset_id: null,
        duration_seconds: null,
        identity_reject: false,
        take_analysis: null,
        line_revised_at: iso(clock),
        line_revision: (shot.shot_data.line_revision ?? 0) + 1,
      },
    };
    store.shots.set(revised.id, revised);
    return revised;
  }

  /**
   * Editorial fallback for a shot that cannot produce a clean take. An on-camera
   * line becomes off-screen speech over the partner's listener close-up (first-
   * class coverage in this house style, and free of lip-sync); a silent single
   * becomes a plate cutaway of the room. Either way the line survives, the
   * attempt budget resets, and the production can finish.
   */
  async function fallbackCoverage(input: { owner_id: string; shot_id: string }) {
    const { shot } = requireShot(input.shot_id, input.owner_id);
    const scene = store.scenes.get(shot.scene_id);
    const cast = scene?.scene_data.characters ?? [];
    const speaker = shot.shot_data.speaker ?? shot.shot_data.speaker_on_camera ?? null;
    const partner = cast.find((name) => speaker == null || !sameName(name, speaker)) ?? null;
    const hasLine = Boolean(shot.shot_data.dialogue?.trim());
    const isWide = shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing";
    let next: Shot;
    if (hasLine && !isWide && partner && shot.shot_data.audio_role !== "offscreen") {
      next = {
        ...shot,
        status: shot.shot_data.dialogue_audio_asset_id ? "audio_ready" : "planned",
        selected_generation_id: null,
        shot_data: {
          ...shot.shot_data,
          audio_role: "offscreen",
          speaker_on_camera: partner,
          speakers_off_camera: speaker ? [speaker] : [],
          mouth_visibility_required: false,
          function: "listener_hold",
          type: "reaction",
          camera: `Listener close-up on ${partner}, hearing the line off-screen, mouth closed, eyes to the off-screen speaker`,
          identity_reject: false,
          take_analysis: null,
          line_revised_at: iso(clock),
          coverage_fallback: "offscreen_over_listener",
        },
      };
    } else {
      next = {
        ...shot,
        status: shot.shot_data.dialogue_audio_asset_id || !hasLine ? "audio_ready" : "planned",
        selected_generation_id: null,
        shot_data: {
          ...shot.shot_data,
          type: "establishing",
          function: "establishing",
          audio_role: hasLine ? "offscreen" : "silent",
          speaker_on_camera: null,
          speakers_off_camera: hasLine && speaker ? [speaker] : shot.shot_data.speakers_off_camera,
          mouth_visibility_required: false,
          camera: `establishing wide of ${scene?.location ?? "the room"}, empty room, no people`,
          identity_reject: false,
          take_analysis: null,
          line_revised_at: iso(clock),
          coverage_fallback: "plate_cutaway",
        },
      };
    }
    store.shots.set(next.id, next);
    return next;
  }

  async function regenerateShot(input: {
    owner_id: string;
    shot_id: string;
    video_tier?: import("./domain.ts").VideoTier;
  }) {
    const { shot } = requireShot(input.shot_id, input.owner_id);
    const videoTier = input.video_tier ?? "pro";
    // Attempts made on a previous version of the line do not count against this one.
    const since = shot.shot_data.line_revised_at ?? "";
    const prior = [...store.jobs.values()]
      .filter((job) => job.shot_id === shot.id && job.job_type === "video" && job.created_at >= since)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    if (prior.length >= RETRY_CAP) {
      throw new Error("Retry cap reached for this shot");
    }
    const last = prior.find((job) => job.model);
    const lastModel = last?.model;
    const lastReasons = ((last?.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? []) as string[];
    const failover =
      lastModel && shouldFailoverModel(lastModel, lastReasons)
        ? failoverRoute(shot, { ...VIDEO_ROUTES.dialogue_default, model: lastModel }, videoTier)
        : lastModel
          ? { model: lastModel }
          : null;
    store.shots.set(shot.id, {
      ...shot,
      status: shot.shot_data.dialogue_audio_asset_id ? "audio_ready" : "planned",
    });
    return generateVideo({ ...input, forceModel: failover?.model, video_tier: videoTier });
  }

  async function gc() {
    const actions = planRetention({
      now: clock.now(),
      series: [...store.series.values()],
      assets: "snapshot" in assets && typeof assets.snapshot === "function"
        ? assets.snapshot()
        : (await Promise.all(
            [...store.series.keys()].map((seriesId) => assets.listBySeries(seriesId)),
          )).flat(),
      jobs: [...store.jobs.values()],
      selectedAssetIds: store.selectedAssetIds(),
    });
    for (const action of actions) {
      await assets.delete(action.asset_id, iso(clock));
    }
    return actions;
  }

  function estimateEpisode(
    episodeId: string,
    quality: QualityProfile = "auto",
    videoTier: import("./domain.ts").VideoTier = "pro",
  ) {
    const shots = store.shotsForEpisode(episodeId);
    const costs = shots.map((shot) => {
      const decision = ai.router.selectVideoRoute(
        shot,
        "standard",
        videoTier === "catalog" ? "economy" : quality,
        videoTier,
      );
      const duration =
        shot.shot_data.duration_seconds ??
        Math.max(decision.route.min_duration_seconds, shot.shot_data.duration_hint_seconds);
      const video = ai.pricing.estimateVideo(decision.route.model, duration);
      const audio = shot.shot_data.dialogue ? ai.pricing.estimateDialogue() : 0;
      return video + audio;
    });
    const min = costs.reduce((sum, value) => sum + value, 0);
    return {
      shots: shots.length,
      scenes: store.scenesFor(store.episodes.get(episodeId)!.id).length,
      estimated_min: min,
      estimated_max: min * 1.35,
    };
  }

  return {
    store,
    assets,
    createSeries,
    analyze,
    generateAppearance,
    createActor,
    generateActor,
    attachActor,
    generateWardrobe,
    designVoice,
    lockCharacter,
    lockLocations,
    lockLocation,
    renderLibraryPlate,
    lockProp,
    attachSeriesCover,
    attachSourceScript,
    segmentSourceScript,
    generateSeriesCover,
    createEpisode,
    planEpisode,
    generateDialogue,
    generateVideo,
    submitVideoJob,
    ingestVideoJob,
    handleOpenRouterWebhook,
    handleStripeWebhook,
    applyAdjustment,
    tick,
    reconcile,
    renderEpisode,
    regenerateShot,
    reviewTake,
    reviseLine,
    fallbackCoverage,
    rejudgeShot,
    gc,
    estimateEpisode,
    estimateSeries(episodeCount: SeasonSku, length?: EpisodeLength) {
      return estimateSeriesCost({ episode_count: episodeCount, length });
    },
    balance(seriesId: string) {
      return projectBalance(store.ledger.filter((row) => row.series_id === seriesId));
    },
    getJob(jobId: string) {
      return store.jobs.get(jobId) ?? null;
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
