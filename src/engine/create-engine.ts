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
import { concatMp4Segments, mergeManifests, mergeVtt } from "./media/concat.ts";
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
import { allowsTwoShot, isObjectInsert } from "../drama-engine/types/editorial.ts";
import type {
  Actor,
  ActorSource,
  AlignmentTrack,
  AppearanceProfile,
  Character,
  Episode,
  GenerationJob,
  LedgerEntry,
  PrivacyProfile,
  QualityProfile,
  RenderManifest,
  SeasonSku,
  Series,
  Shot,
  StoryBible,
  VisualReferenceKind,
  VoiceCandidate,
} from "./domain.ts";
import { extractAudioMp3 } from "./media/extract-audio.ts";
import { alignVoicePrompt } from "./ai/voice-sex.ts";
import { shouldSampleDialogueStt } from "./pipeline/stt-qc.ts";
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
import { runIdentityStage, shrinkReference } from "./pipeline/identity-check.ts";
import { wordErrorRate } from "./media/qc.ts";
import { evidenceMotif, objectPlateCamera } from "../drama-engine/craft/prompt-fragments.ts";
import { playbookFor } from "../drama-engine/craft/genre-playbooks.ts";
import { isLongFormLength, ledgerForEpisode, planLongFormEpisode } from "../drama-engine/plans/index.ts";
import { failoverRoute } from "./ai/router.ts";
import {
  orderIdentityRefs,
  resolveIdentityRefPolicy,
  shouldFailoverModel,
  type IdentityRefPolicy,
} from "./pipeline/identity-refs.ts";
import { isActive, isTerminal, transitionJob } from "./jobs/state-machine.ts";
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

/** Below this many takes an episode renders in one pass; above it, per block with reuse. */
export const BLOCK_RENDER_MIN_SHOTS = 24;
/** Image attempts for an empty location plate before the lock fails loudly. */
export const LOCATION_PLATE_ATTEMPTS = 4;

function emptyAppearance(): AppearanceProfile {
  return { age_look: "", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" };
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

  async function moderate(content: string, checkpoint: "story_input" | "character_create" | "shot_submit", seriesId: string | null, jobId: string | null) {
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

  async function analyze(input: { owner_id: string; series_id: string }) {
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
    const bible = await ai.llm.analyzeStory({
      title: series.title,
      idea: series.description,
    });
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
    for (const draft of bible.characters) {
      const character: Character = {
        id: ids.id(),
        series_id: series.id,
        name: draft.name,
        description: draft.description,
        actor_id: null,
        appearance_profile: draft.appearance,
        visual_reference_asset_ids: {},
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
    for (const kind of FACE_KIND_ORDER) {
      if (refs[kind]) continue;
      const image = await ai.image.generateReference({
        characterName: character.name,
        description,
        kind,
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
  }) {
    let actor = store.actors.get(input.actor_id);
    if (!actor || actor.owner_id !== input.owner_id) throw new Error("Actor not found");
    requireSeries(input.series_id, input.owner_id);
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
    }
    if (Object.keys(actor.visual_reference_asset_ids).length > 0) return actor;
    const existing = findJobByKey(`appearance:actor:${actor.id}`);
    const saved = (existing?.result_metadata.refs ?? null) as Partial<Record<VisualReferenceKind, string>> | null;
    if (saved && Object.keys(saved).length > 0) {
      const next = { ...actor, visual_reference_asset_ids: saved, updated_at: iso(clock) };
      store.actors.set(actor.id, next);
      return next;
    }
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
      idempotency_key: `appearance:actor:${actor.id}`,
      status: "queued",
      request_metadata: { actor_id: actor.id },
      estimated_cost: ai.pricing.estimateImage() * FACE_KIND_ORDER.length,
      expected_ready_at: addSeconds(clock, 30),
    });
    if (job.status === "completed") {
      const refs = (job.result_metadata.refs ?? saved ?? {}) as Partial<Record<VisualReferenceKind, string>>;
      const next = { ...actor, visual_reference_asset_ids: refs, updated_at: iso(clock) };
      store.actors.set(actor.id, next);
      return next;
    }
    if (job.status !== "queued" && job.status !== "failed") return actor;
    if (!reservedForJob(store.ledger, job.id)) reserve(job);
    const description = appearanceDescription({ description: actor.name, ...actor.appearance_profile });
    const refs: Partial<Record<VisualReferenceKind, string>> = {};
    const seed = actor.seed_asset_id ? await assets.get(actor.seed_asset_id) : null;
    for (const kind of FACE_KIND_ORDER) {
      const image = seed
        ? await ai.image.generateReferenceFromSeed({
            characterName: actor.name,
            description,
            kind,
            seed_bytes: seed.body,
            seed_mime_type: seed.asset.mime_type,
          })
        : await ai.image.generateReference({
            characterName: actor.name,
            description,
            kind,
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
    }
    const next = { ...actor, visual_reference_asset_ids: refs, updated_at: iso(clock) };
    store.actors.set(actor.id, next);
    for (const character of store.characters.values()) {
      if (character.actor_id === actor.id && !character.locked) {
        store.characters.set(character.id, {
          ...character,
          visual_reference_asset_ids: refs,
          updated_at: iso(clock),
        });
      }
    }
    completeSyncJob(job, job.estimated_cost, { actor_id: actor.id, refs });
    return next;
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
  }) {
    const character = requireCharacter(input.character_id, input.owner_id);
    if (character.locked && character.voice_profile.elevenlabs_voice_id) return character;
    if (Object.keys(faceRefsFor(character)).length === 0) {
      await generateAppearance(input);
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
      estimated_cost: ai.pricing.estimateImage() * missing.length,
      expected_ready_at: addSeconds(clock, 30),
    });
    reserve(job);
    for (const location of missing) {
      // The plate seeds every wide in this location; a person in it is a
      // person in every wide. Judge it and regenerate until the room is empty.
      let image: Awaited<ReturnType<typeof ai.image.generateReference>> | null = null;
      let peoplePresent: boolean | null = null;
      let notes: Record<string, unknown> = {};
      // The physical description only; a name like "wall of household files"
      // reads as a household and the model staffs it.
      const physical = location.split(/\s[—–-]\s/).slice(1).join(", ").trim() || location;
      for (let attempt = 0; attempt < LOCATION_PLATE_ATTEMPTS; attempt += 1) {
        const candidate = await ai.image.generateReference({
          characterName: location,
          description:
            attempt === 0
              ? `Cinematic Hollywood establishing still of ${location}: banquet hall, estate lobby, castle corridor, or night kitchen as the name implies. One locked key light and grade. ` +
                `EMPTY ROOM. NO people, NO faces, NO extras, NO bodies, NO clothing on a person, no silhouettes, no figures with their back to camera, no reflections of people, no portraits or photographs of people on the walls.`
              : `Unoccupied interior, architectural photography for a design magazine: ${physical}. Vacant, nobody present, no staff, no figures, no silhouettes, no reflections of people, no portraits or photographs of people on the walls, no mannequins. ` +
                `Wide 9:16 frame, one key light and grade, cinematic colour. The room is empty and still.`,
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
          notes = { lighting_lock: described.lighting_lock, palette: described.palette, key_light: described.key_light, dressing: described.dressing, people_present: described.people_present };
          if (!described.people_present) break;
        } catch {
          break;
        }
      }
      if (!image) throw new Error(`Could not generate a location plate for ${location}`);
      if (peoplePresent) {
        throw new Error(`Location plate for ${location} still shows a human figure after ${LOCATION_PLATE_ATTEMPTS} attempts`);
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
      refs[location] = asset.id;
    }
    const next = { ...series, location_refs: refs };
    store.series.set(series.id, next);
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
      render_manifest: null,
      created_at: iso(clock),
      updated_at: iso(clock),
    };
    store.episodes.set(episode.id, episode);
    return episode;
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
    if (cast.length === 0 || cast.some((character) => !character.locked || !character.voice_profile.elevenlabs_voice_id)) {
      throw new Error("Lock every character face and voice before planEpisode.");
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
    const plan = dramaHooks.assertEpisodePlan({
      plan: dramaHooks.repairEpisodePlan({
        plan: planned,
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
            camera: dramaHooks.sanitizeCamera(shotPlan.camera),
            mouth_visibility_required: shotPlan.mouth_visibility_required,
            duration_hint_seconds: shotPlan.duration_hint_seconds,
            duration_seconds: null,
            dialogue_audio_asset_id: null,
            dialogue_alignment_asset_id: null,
            hero: Boolean(shotPlan.hero),
            edit_mode: craft.edit_mode,
            audio_role: craft.audio_role,
            speaker_on_camera: shotPlan.speaker_on_camera ?? (craft.audio_role === "offscreen" ? null : shotPlan.speaker),
            speakers_off_camera: shotPlan.speakers_off_camera ?? [],
            eyeline: craft.eyeline,
            function: craft.function,
            block_index: scenePlan.block_index ?? shotPlan.block_index,
            look_id: lookId,
            silence_license: shotPlan.silence_license ?? null,
            recap: Boolean(shotPlan.recap),
            camera_move: shotPlan.camera_move ?? null,
            comic_sting: Boolean(shotPlan.comic_sting),
            sfx: shotPlan.sfx ?? null,
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
    const talker =
      shot.shot_data.audio_role === "offscreen"
        ? (shot.shot_data.speakers_off_camera?.[0] ?? shot.shot_data.speaker)
        : shot.shot_data.speaker;
    if (!shot.shot_data.dialogue || !talker) {
      throw new Error("Shot has no dialogue");
    }
    const character = characterBySpeaker(series.id, talker);
    if (!character.locked || !character.voice_profile.elevenlabs_voice_id) {
      throw new Error("Character voice is not locked");
    }
    await moderate(shot.shot_data.dialogue, "shot_submit", series.id, null);
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
      idempotency_key: `tts:${shot.id}:${character.voice_profile.voice_version}`,
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

  async function generateVideo(input: {
    owner_id: string;
    shot_id: string;
    quality?: QualityProfile;
    privacy?: PrivacyProfile;
    forceModel?: string;
  }) {
    const { shot, series, episode } = requireShot(input.shot_id, input.owner_id);
    const quality = input.quality ?? "auto";
    const privacy: PrivacyProfile = input.privacy ?? "standard";
    assertStandardOnly(privacy);

    if (shot.shot_data.dialogue && !shot.shot_data.dialogue_audio_asset_id) {
      await generateDialogue({ owner_id: input.owner_id, shot_id: shot.id });
    }
    const live = store.shots.get(shot.id)!;
    const scene = store.scenes.get(live.scene_id);
    const location = scene?.location || scene?.scene_data.location;

    // Empty establishing wides are cut from the location plate, not generated:
    // the plate has nobody in it by construction and matches the scene's light.
    const emptyWide =
      (live.shot_data.function === "establishing" || live.shot_data.type === "establishing") &&
      !live.shot_data.dialogue &&
      !live.shot_data.group_still_asset_id &&
      !isObjectInsert(live.shot_data);
    if (emptyWide) {
      const fromPlate = await plateTakeForShot(live, series, location);
      if (fromPlate) return fromPlate;
    }
    const pictured = live.shot_data.speaker_on_camera ?? (live.shot_data.audio_role === "offscreen" ? null : live.shot_data.speaker);
    const others = (scene?.scene_data.characters ?? []).filter((name) => !sameName(name, pictured));
    const partner =
      live.shot_data.audio_role === "offscreen"
        ? live.shot_data.speakers_off_camera?.[0] ?? live.shot_data.speaker
        : others[0] ?? null;
    const prompt = dramaHooks.buildVideoPrompt({
      location,
      locationNote: await locationNoteFor(series.id, location),
      genre: seriesGenre(series),
      shot: live,
      partner,
      peopleCount: allowsTwoShot(live.shot_data.function) ? 2 : 1,
      otherNames: others,
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
    const padded = Math.max(provisional, VIDEO_ROUTES.economy_default.min_duration_seconds);
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
      : ai.router.selectVideoRoute(current, privacy, quality);
    const duration = current.shot_data.duration_seconds ?? padded;

    const estimated = ai.pricing.estimateVideo(decision.route.model, duration);
    const active = [...store.jobs.values()].find(
      (row) => row.shot_id === current.id && row.job_type === "video" && isActive(row.status),
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
  ): Promise<{ job: GenerationJob; route: { route: { model: string; provider: string }; reason: string } } | null> {
    const plateId = locationRefForScene(series.location_refs ?? {}, location);
    if (!plateId) return null;
    const plate = await assets.get(plateId).catch(() => null);
    if (!plate) return null;
    const seconds = shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds ?? 4;
    const move = plateMoveFor(shot.id);
    const body = await plateFn(plate.body, seconds, move);
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
      request_metadata: { reason: "empty establishing from location plate", plate_asset_id: plateId, move, first_frame_asset_id: plateId },
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
      shot_data: { ...live.shot_data, take_analysis: analysis, identity_reject: false, heard_audio: "silent", first_frame_asset_id: plateId },
    });
    settle(current, 0);
    return { job: current, route: { route: { model: "plate/zoompan", provider: "local" }, reason: "empty establishing from location plate" } };
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
  function speechTranscriber(): ((mp3: Uint8Array) => Promise<{ text: string; speech_onset_seconds: number | null } | null>) | undefined {
    const stt = ai.stt;
    if (!stt) return undefined;
    return async (mp3) => {
      const spoken = await stt.transcribe({ bytes: mp3, format: "mp3" });
      return { text: spoken.text, speech_onset_seconds: spoken.speech_onset_seconds ?? null };
    };
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

  async function ensureInsertPlate(shot: Shot, seriesId: string): Promise<string | null> {
    const cached = shot.shot_data.insert_plate_id;
    if (cached) {
      const existing = await signedOrSkip(cached);
      if (existing) return existing;
    }
    const series = store.series.get(seriesId);
    if (!series) return null;
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

  async function visualRefsForShot(
    shot: Shot,
    seriesId: string,
    locationOnly: boolean,
  ): Promise<{
    urls: string[];
    first_frame_kind: ReturnType<typeof firstFrameKind>;
    first_frame_asset_id: string | null;
  }> {
    const objectInsert = isObjectInsert(shot.shot_data);
    if (objectInsert) {
      const plate = await ensureInsertPlate(shot, seriesId);
      const plateId = store.shots.get(shot.id)?.shot_data.insert_plate_id ?? null;
      return { urls: plate ? [plate] : [], first_frame_kind: "object", first_frame_asset_id: plateId };
    }
    if (locationOnly) return { urls: [], first_frame_kind: "face", first_frame_asset_id: null };
    const scene = store.scenes.get(shot.scene_id);
    const seriesForLoc = store.series.get(seriesId);
    const locIdEarly = locationRefForScene(seriesForLoc?.location_refs ?? {}, scene?.location);
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
      const shot = store.shots.get(job.shot_id ?? "");
      if (!shot) throw new Error("Shot missing for video submit");
      const refs = await visualRefsForShot(shot, job.series_id, false);
      let visual_reference_urls = refs.urls;
      let frameKind = refs.first_frame_kind;
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
        prompt: String(job.request_metadata.prompt ?? ""),
        visual_reference_urls,
        audio_reference_url,
        duration_seconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
        model: job.model ?? VIDEO_ROUTES.economy_default.model,
        privacy_profile: "standard" as const,
        callback_url: openRouterCallbackUrl(job.callback_token),
      };
      let submitted;
      try {
        submitted = await ai.video.submit(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isInputImagePrivacyFailure(message) || visual_reference_urls.length === 0) {
          throw error;
        }
        const retry = visual_reference_urls.length > 1
          ? await visualRefsForShot(shot, job.series_id, true)
          : { urls: [] as string[], first_frame_kind: frameKind };
        visual_reference_urls = retry.urls;
        frameKind = retry.first_frame_kind;
        submitted = await ai.video.submit({ ...payload, visual_reference_urls });
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
    const dialogueCu =
      Boolean(shot.shot_data.dialogue) &&
      shot.shot_data.audio_role !== "offscreen" &&
      shot.shot_data.audio_role !== "silent" &&
      !isObjectInsert(shot.shot_data);
    const audioConditioned = Boolean(
      shot.shot_data.dialogue &&
        shot.shot_data.audio_role !== "offscreen" &&
        shot.shot_data.audio_role !== "silent" &&
        shot.shot_data.dialogue_audio_asset_id,
    );

    // One measurement pass per take: settle, mouth/voice sync, second body,
    // modesty, and internal cuts (counted after the settle so the I2V morph
    // is not mistaken for a cut). Persisted so the mixer and audits reuse it.
    const stillBody = typeof stillId === "string" ? (await assets.get(stillId).catch(() => null))?.body ?? null : null;
    const modestId = shot.shot_data.modest_still_asset_id ?? (await modestStillForShot(shot));
    const modestBody = modestId ? (await assets.get(modestId).catch(() => null))?.body ?? null : null;
    let analysis = await measureTake({
      video: downloaded.bytes,
      still: stillBody,
      modestStill: modestBody,
      dialogueCu,
      wanDialogue: dialogueCu && (job.model ?? "").includes("wan"),
      locateFace: faceLocator(),
      transcribe: speechTranscriber(),
    });

    // Identity stage: how many people are in frame, and is it the locked cast
    // member. Empty wides expect 0 faces and need no reference; singles expect 1
    // against the CU still; object inserts are never judged.
    const emptyWide =
      (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") &&
      !shot.shot_data.dialogue &&
      !shot.shot_data.group_still_asset_id;
    const expectedFaces = isObjectInsert(shot.shot_data)
      ? null
      : emptyWide
        ? 0
        : allowsTwoShot(shot.shot_data.function) && shot.shot_data.group_still_asset_id
          ? 2
          : 1;
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

    const verdict = scoreTake(analysis, {
      dialogueCu,
      lockedTake: (shot.shot_data.edit_mode ?? "locked_take") === "locked_take",
      expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
      expectedFaces,
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
        });
        store.shots.set(shot.id, {
          ...store.shots.get(shot.id)!,
          shot_data: {
            ...store.shots.get(shot.id)!.shot_data,
            heard_audio: lane,
          },
        });
        // Native stays even when the transcript drifts (never mux TTS over lips timed
        // to this take), but the drift is now a real QC reason instead of a comment.
        if (shot.shot_data.dialogue) {
          const wer = wordErrorRate(shot.shot_data.dialogue, spoken.text);
          current = {
            ...current,
            request_metadata: { ...current.request_metadata, native_transcript: spoken.text, native_wer: Number(wer.toFixed(3)) },
          };
          store.jobs.set(current.id, current);
          if (wer > 0.25) qc = { pass: false, reasons: [...new Set([...qc.reasons, "transcript_wer"])] };
          else if (wer > 0.15) qc = { pass: qc.pass, reasons: [...new Set([...qc.reasons, "transcript_wer_warn"])] };
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
            !shot.shot_data.dialogue)));
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

    if (blockingQcReasons(qc.reasons).length > 0 || !qc.pass) {
      current = transitionJob(current, "needs_review", iso(clock), {
        result_metadata: takeRecord,
        actual_cost: actualCost,
      });
      store.jobs.set(job.id, current);
      if (!dropTake) bindShotTake(store.shots.get(shot.id)!, asset.id, "needs_review");
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
      shot_data: { ...live.shot_data, take_reviews: reviews, identity_reject: input.decision === "approve" ? false : live.shot_data.identity_reject },
    };
    // The approved take's own measurements drive the manifest for this shot.
    if (input.decision === "approve") {
      const ranked = await rankedTakesForShot(next, series.id);
      const chosen = ranked.find((row) => row.assetId === input.asset_id);
      if (chosen?.analysis) next.shot_data = { ...next.shot_data, take_analysis: chosen.analysis };
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
    const dialogueCu =
      Boolean(shot.shot_data.dialogue) &&
      shot.shot_data.audio_role !== "offscreen" &&
      shot.shot_data.audio_role !== "silent" &&
      !isObjectInsert(shot.shot_data);
    const emptyWide =
      (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") &&
      !shot.shot_data.dialogue &&
      !shot.shot_data.group_still_asset_id;
    const expectedFaces = isObjectInsert(shot.shot_data) ? null : emptyWide ? 0 : 1;
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
      const verdict = scoreTake(analysis, {
        dialogueCu,
        lockedTake: (shot.shot_data.edit_mode ?? "locked_take") === "locked_take",
        expectedDurationSeconds: shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds,
        expectedFaces,
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
    store.shots.set(current.id, {
      ...current,
      status: chosen ? "complete" : "needs_review",
      selected_generation_id: chosen,
      shot_data: { ...current.shot_data, identity_reject: !chosen },
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
    const groups = blockGroups(takes);
    const rendered =
      groups.length > 1 && takes.length >= blockRenderMinShots
        ? await renderInBlocks(episode, groups, input.owner_id)
        : await renderSlice(episode, takes);
    const { manifest, analyses, heardLanes } = rendered;

    // Gate: the same frame audit that shipped lock-v9, on the bytes we are about
    // to call final. The audit JSON is stored either way so reviewers can see
    // why a cut passed or was refused.
    const muxAudit = await audit({
      body: rendered.body,
      manifest,
      analyses,
      heardLanes,
      transcribe: ai.stt
        ? async (mp3) => {
            const spoken = await ai.stt!.transcribe({ bytes: mp3, format: "mp3" });
            return { words: spoken.words ?? [] };
          }
        : undefined,
    });
    return await finalizeRender({ input, episode, takes, rendered, muxAudit });
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
    manifest: RenderManifest;
    analyses: Array<TakeAnalysis | null>;
    heardLanes: Array<"native" | "tts" | "silent">;
  };

  /** What a block render depends on; identical inputs reuse the stored block. */
  function blockFingerprint(rows: Array<{ shot: Shot; assetId: string }>): string {
    return sha256HexSync(
      stableStringify(
        rows.map((row) => ({
          shot: row.shot.id,
          take: row.assetId,
          measured: row.shot.shot_data.take_analysis?.measured_at ?? null,
          heard: row.shot.shot_data.heard_audio ?? null,
          alignment: row.shot.shot_data.dialogue_alignment_asset_id ?? null,
          audio: row.shot.shot_data.dialogue_audio_asset_id ?? null,
          silence: row.shot.shot_data.silence_license ?? null,
        })),
      ),
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
    const pieces: Array<{ body: Uint8Array; vtt: string; manifest: RenderManifest; analyses: Array<TakeAnalysis | null>; heardLanes: Array<"native" | "tts" | "silent">; seconds: number; reused: boolean }> = [];
    for (const group of groups) {
      const fingerprint = blockFingerprint(group.takes);
      const cached = existing.find((asset) => asset.metadata.block_index === group.block && asset.metadata.fingerprint === fingerprint);
      const stored = cached ? await assets.get(cached.id).catch(() => null) : null;
      if (stored && typeof cached?.metadata.vtt === "string" && cached.metadata.manifest) {
        const seconds = probeVideoBytes(stored.body).duration_seconds;
        pieces.push({
          body: stored.body,
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
        },
      });
      pieces.push({ ...slice, seconds, reused: false });
    }
    const body = await concat(pieces.map((piece) => piece.body));
    if (!body) throw new RenderFailedError("block concatenation failed");
    let offset = 0;
    const offsets = pieces.map((piece) => {
      const at = offset;
      offset += piece.seconds;
      return at;
    });
    return {
      body,
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
      durationFor: (shot) => {
        const planned = shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds;
        const take = takeDuration.get(shot.id);
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
        alignments.push(null);
      }
      if (shot.shot_data.dialogue_audio_asset_id) {
        const audio = await assets.get(shot.shot_data.dialogue_audio_asset_id);
        ttsBodies.push(audio?.body ?? null);
      } else {
        ttsBodies.push(null);
      }
      let native: Uint8Array | null = null;
      if (shot.shot_data.heard_audio === "native") {
        try {
          native = await extractAudioMp3(shotBodies[index]!);
        } catch {
          native = null;
        }
      }
      nativeAudio.push(native);
      const audioConditioned = Boolean(
        shot.shot_data.dialogue &&
          shot.shot_data.dialogue_audio_asset_id &&
          shot.shot_data.audio_role !== "offscreen" &&
          shot.shot_data.audio_role !== "silent",
      );
      heardLanes.push(
        shot.shot_data.audio_role === "silent" || !shot.shot_data.dialogue
          ? "silent"
          : native
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
      visemePadSeconds: analyses.map((row) => (row ? row.viseme_pad_seconds : null)),
      visemeMouthOpenSeconds: analyses.map((row) => row?.mouth_open_seconds ?? null),
      visemeVoiceOnsetSeconds: analyses.map((row) => row?.voice_onset_seconds ?? null),
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
    if (!muxAudit.ship) {
      store.episodes.set(episode.id, {
        ...episode,
        render_manifest: manifest,
        status: "needs_review",
        updated_at: iso(clock),
      });
      throw new RenderFailedError(`mux audit refused the cut (${muxAudit.reasons.join(", ")}); audit ${auditAsset.id}`);
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

  async function regenerateShot(input: { owner_id: string; shot_id: string }) {
    const { shot } = requireShot(input.shot_id, input.owner_id);
    const prior = [...store.jobs.values()]
      .filter((job) => job.shot_id === shot.id && job.job_type === "video")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    if (prior.length >= RETRY_CAP) {
      throw new Error("Retry cap reached for this shot");
    }
    const last = prior.find((job) => job.model);
    const lastModel = last?.model;
    const lastReasons = ((last?.result_metadata.qc as { reasons?: string[] } | undefined)?.reasons ?? []) as string[];
    const failover =
      lastModel && shouldFailoverModel(lastModel, lastReasons)
        ? failoverRoute(shot, { ...VIDEO_ROUTES.dialogue_default, model: lastModel })
        : lastModel
          ? { model: lastModel }
          : null;
    store.shots.set(shot.id, {
      ...shot,
      status: shot.shot_data.dialogue_audio_asset_id ? "audio_ready" : "planned",
    });
    return generateVideo({ ...input, forceModel: failover?.model });
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

  function estimateEpisode(episodeId: string, quality: QualityProfile = "auto") {
    const shots = store.shotsForEpisode(episodeId);
    const costs = shots.map((shot) => {
      const decision = ai.router.selectVideoRoute(shot, "standard", quality);
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
