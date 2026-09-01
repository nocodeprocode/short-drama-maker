import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Actor,
  Asset,
  Character,
  Episode,
  GenerationJob,
  LedgerEntry,
  ModerationDecision,
  Scene,
  SeasonSku,
  Series,
  Shot,
  StoryBible,
} from "./domain.ts";
import { DEFAULT_DAILY_SPEND_CAP, PRICE_SNAPSHOT_VERSION } from "./config/models.ts";
import { queueVisibleAt } from "./jobs/queue-policy.ts";
import { MemoryStore } from "./store.ts";
import type { HttpAssetStore } from "./storage/http.ts";

type SeriesRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  style_profile: Record<string, unknown>;
  story_bible: StoryBible | null;
  target_episode_count: number | null;
  sku: string | null;
  location_refs: Record<string, string> | null;
  cover_asset_id?: string | null;
  status: Series["status"];
  deleted_at: string | null;
  created_at: string;
};

type CharacterRow = {
  id: string;
  series_id: string;
  actor_id?: string | null;
  name: string;
  description: string;
  visual_profile: Record<string, unknown>;
  voice_profile: Character["voice_profile"];
  locked: boolean;
  created_at: string;
  updated_at: string;
};

type ActorRow = Actor;

type EpisodeRow = Episode;
type SceneRow = Scene;
type ShotRow = Shot;
type JobRow = GenerationJob;
type LedgerRow = LedgerEntry;
type ModerationRow = ModerationDecision;
type AssetRow = Asset & { bytes: number };

function asSku(value: number | null): SeasonSku | null {
  return value === 2 || value === 12 || value === 24 || value === 45 || value === 60
    ? value
    : null;
}

function seriesFromRow(row: SeriesRow): Series {
  return {
    id: row.id,
    owner_id: row.owner_id,
    title: row.title,
    description: row.description,
    style_profile: row.style_profile ?? {},
    story_bible: row.story_bible,
    target_episode_count: asSku(row.target_episode_count),
    sku: row.sku,
    location_refs: row.location_refs ?? {},
    cover_asset_id: row.cover_asset_id ?? null,
    status: row.status,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
  };
}

function characterFromRow(row: CharacterRow): Character {
  const visual = row.visual_profile ?? {};
  return {
    id: row.id,
    series_id: row.series_id,
    actor_id: row.actor_id ?? null,
    name: row.name,
    description: row.description,
    appearance_profile: (visual.appearance_profile ?? {
      age_look: "",
      ethnicity_notes: "",
      hair: "",
      face: "",
      body: "",
      default_wardrobe: "",
    }) as Character["appearance_profile"],
    visual_reference_asset_ids:
      (visual.visual_reference_asset_ids as Character["visual_reference_asset_ids"]) ?? {},
    wardrobe_asset_ids: (visual.wardrobe_asset_ids as Record<string, string>) ?? {},
    voice_profile: row.voice_profile,
    personality_profile: (visual.personality_profile as Record<string, unknown>) ?? {},
    relationships: (visual.relationships as Record<string, string>) ?? {},
    default_wardrobe: String(visual.default_wardrobe ?? ""),
    locked: row.locked,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function characterToRow(character: Character) {
  return {
    id: character.id,
    series_id: character.series_id,
    actor_id: character.actor_id,
    name: character.name,
    description: character.description,
    visual_profile: {
      appearance_profile: character.appearance_profile,
      visual_reference_asset_ids: character.visual_reference_asset_ids,
      wardrobe_asset_ids: character.wardrobe_asset_ids,
      personality_profile: character.personality_profile,
      relationships: character.relationships,
      default_wardrobe: character.default_wardrobe,
    },
    voice_profile: character.voice_profile,
    locked: character.locked,
    created_at: character.created_at,
    updated_at: character.updated_at,
  };
}

export function mergeCharacterCommit(
  incoming: {
    id: string;
    series_id: string;
    actor_id?: string | null;
    name: string;
    description: string;
    visual_profile: Record<string, unknown>;
    voice_profile: Character["voice_profile"];
    locked: boolean;
    created_at: string;
    updated_at: string;
  },
  existing: { visual_profile?: Record<string, unknown> | null; voice_profile?: Character["voice_profile"] | null; locked?: boolean; created_at?: string; actor_id?: string | null } | null,
) {
  const priorVisual = (existing?.visual_profile ?? {}) as Record<string, unknown>;
  const nextVisual = incoming.visual_profile as Record<string, unknown>;
  const priorRefs = (priorVisual.visual_reference_asset_ids ?? {}) as Record<string, string>;
  const nextRefs = (nextVisual.visual_reference_asset_ids ?? {}) as Record<string, string>;
  const priorLooks = (priorVisual.wardrobe_asset_ids ?? {}) as Record<string, string>;
  const nextLooks = (nextVisual.wardrobe_asset_ids ?? {}) as Record<string, string>;
  const priorVoice = existing?.voice_profile ?? incoming.voice_profile;
  const nextVoice = incoming.voice_profile;
  const existingRepair =
    Boolean(existing) &&
    !existing?.locked &&
    !priorVoice.elevenlabs_voice_id &&
    Boolean(priorVoice.design_prompt) &&
    priorVoice.design_prompt !== nextVoice.design_prompt;
  return {
    ...incoming,
    created_at: existing?.created_at ?? incoming.created_at,
    actor_id: incoming.actor_id ?? existing?.actor_id ?? null,
    locked: existingRepair ? false : Boolean(incoming.locked || existing?.locked),
    visual_profile: {
      ...priorVisual,
      ...nextVisual,
      visual_reference_asset_ids: { ...priorRefs, ...nextRefs },
      wardrobe_asset_ids: { ...priorLooks, ...nextLooks },
    },
    voice_profile: existingRepair
      ? priorVoice
      : {
          ...priorVoice,
          ...nextVoice,
          elevenlabs_voice_id: nextVoice.elevenlabs_voice_id ?? priorVoice.elevenlabs_voice_id,
          canonical_reference_asset_id:
            nextVoice.canonical_reference_asset_id ?? priorVoice.canonical_reference_asset_id,
          pending_previews:
            nextVoice.pending_previews?.length ? nextVoice.pending_previews : priorVoice.pending_previews,
          locked: Boolean(nextVoice.locked || priorVoice.locked),
        },
  };
}

export async function loadSeriesStore(
  client: SupabaseClient,
  seriesId: string,
): Promise<{ store: MemoryStore; assets: Asset[] }> {
  const store = new MemoryStore();
  const [
    seriesRes,
    charactersRes,
    episodesRes,
    jobsRes,
    ledgerRes,
    moderationRes,
    assetsRes,
    spendRes,
  ] = await Promise.all([
    client.from("series").select("*").eq("id", seriesId).maybeSingle(),
    client.from("characters").select("*").eq("series_id", seriesId),
    client.from("episodes").select("*").eq("series_id", seriesId),
    client.from("generation_jobs").select("*").eq("series_id", seriesId),
    client.from("project_ledger").select("*").eq("series_id", seriesId),
    client.from("moderation_decisions").select("*").eq("series_id", seriesId),
    client.from("assets").select("*").eq("series_id", seriesId),
    client.from("spend_controls").select("*").eq("id", "global").maybeSingle(),
  ]);

  const errors = [
    seriesRes.error,
    charactersRes.error,
    episodesRes.error,
    jobsRes.error,
    ledgerRes.error,
    moderationRes.error,
    assetsRes.error,
    spendRes.error,
  ].filter(Boolean);
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error!.message).join("; "));
  }
  if (!seriesRes.data) throw new Error("Series not found");

  const series = seriesFromRow(seriesRes.data as SeriesRow);
  store.series.set(series.id, series);

  for (const row of (charactersRes.data ?? []) as CharacterRow[]) {
    store.characters.set(row.id, characterFromRow(row));
  }

  const actorsRes = await client.from("actors").select("*").eq("owner_id", series.owner_id);
  if (actorsRes.error) throw new Error(actorsRes.error.message);
  for (const row of (actorsRes.data ?? []) as ActorRow[]) store.actors.set(row.id, row);

  const actorIds = [...store.actors.keys()];
  const extraAssetsRes = actorIds.length
    ? await client.from("assets").select("*").in("actor_id", actorIds).is("deleted_at", null)
    : { data: [], error: null };
  if (extraAssetsRes.error) throw new Error(extraAssetsRes.error.message);

  const episodes = (episodesRes.data ?? []) as EpisodeRow[];
  for (const episode of episodes) store.episodes.set(episode.id, episode);

  const episodeIds = episodes.map((row) => row.id);
  const scenesRes =
    episodeIds.length > 0
      ? await client.from("scenes").select("*").in("episode_id", episodeIds)
      : { data: [], error: null };
  if (scenesRes.error) throw new Error(scenesRes.error.message);
  const scenes = (scenesRes.data ?? []) as SceneRow[];
  for (const scene of scenes) store.scenes.set(scene.id, scene);

  const sceneIds = scenes.map((row) => row.id);
  const shotsRes =
    sceneIds.length > 0
      ? await client.from("shots").select("*").in("scene_id", sceneIds)
      : { data: [], error: null };
  if (shotsRes.error) throw new Error(shotsRes.error.message);
  for (const shot of (shotsRes.data ?? []) as ShotRow[]) store.shots.set(shot.id, shot);

  for (const job of (jobsRes.data ?? []) as JobRow[]) {
    store.jobs.set(job.id, {
      ...job,
      estimated_cost: Number(job.estimated_cost),
      actual_cost: job.actual_cost == null ? null : Number(job.actual_cost),
    });
    if (job.status === "queued" || job.status === "submitting" || job.status === "generating") {
      store.queue.push({
        id: job.id,
        job_id: job.id,
        kind: "generate",
        created_at: job.created_at,
        visible_at: queueVisibleAt(job),
      });
    }
  }

  store.ledger = ((ledgerRes.data ?? []) as LedgerRow[]).map((row) => ({
    ...row,
    amount: Number(row.amount),
  }));
  for (const row of store.ledger) {
    if (row.stripe_event_id) store.stripeEvents.add(row.stripe_event_id);
  }
  store.moderation = (moderationRes.data ?? []) as ModerationRow[];

  const assetsById = new Map<string, AssetRow>();
  for (const row of (assetsRes.data ?? []) as AssetRow[]) assetsById.set(row.id, row);
  for (const row of (extraAssetsRes.data ?? []) as AssetRow[]) assetsById.set(row.id, row);
  const assets = [...assetsById.values()].map((row) => ({
    ...row,
    bucket: row.bucket ?? "private-generation",
  }));

  const spend = spendRes.data as
    | { daily_cap: number; daily_spent: number; spent_on: string }
    | null;
  const today = new Date().toISOString().slice(0, 10);
  store.dailyCap = Number(spend?.daily_cap ?? DEFAULT_DAILY_SPEND_CAP);
  store.dailySpend = spend && spend.spent_on === today ? Number(spend.daily_spent) : 0;
  store.priceSnapshotVersion = PRICE_SNAPSHOT_VERSION;

  return { store, assets };
}

export async function commitSeriesStore(
  client: SupabaseClient,
  store: MemoryStore,
  seriesId: string,
  assets?: readonly Asset[],
): Promise<void> {
  const series = store.series.get(seriesId);
  if (!series) throw new Error("Series missing from store");

  const { error: seriesError } = await client.from("series").upsert({
    id: series.id,
    owner_id: series.owner_id,
    title: series.title,
    description: series.description,
    style_profile: series.style_profile,
    story_bible: series.story_bible,
    target_episode_count: series.target_episode_count,
    sku: series.sku,
    location_refs: series.location_refs,
    cover_asset_id: series.cover_asset_id,
    status: series.status,
    deleted_at: series.deleted_at,
    created_at: series.created_at,
  });
  if (seriesError) throw new Error(seriesError.message);

  const characters = store.charactersFor(seriesId).map(characterToRow);
  if (characters.length > 0) {
    const { data: existingRows, error: existingError } = await client
      .from("characters")
      .select("id, visual_profile, voice_profile, locked, created_at, actor_id")
      .eq("series_id", seriesId);
    if (existingError) throw new Error(existingError.message);
    const existingById = new Map((existingRows ?? []).map((row) => [row.id, row]));
    const merged = characters.map((row) => mergeCharacterCommit(row, existingById.get(row.id) ?? null));
    const { error } = await client.from("characters").upsert(merged);
    if (error) throw new Error(error.message);
  }

  const actors = [...store.actors.values()].filter((actor) => actor.owner_id === series.owner_id);
  if (actors.length > 0) {
    const { error } = await client.from("actors").upsert(actors);
    if (error) throw new Error(error.message);
  }

  const episodes = store.episodesFor(seriesId);
  if (episodes.length > 0) {
    const { error } = await client.from("episodes").upsert(episodes);
    if (error) throw new Error(error.message);
  }

  const scenes = episodes.flatMap((episode) => store.scenesFor(episode.id));
  if (scenes.length > 0) {
    const { error } = await client.from("scenes").upsert(scenes);
    if (error) throw new Error(error.message);
  }

  const shots = episodes.flatMap((episode) => store.shotsForEpisode(episode.id));
  if (shots.length > 0) {
    const { error } = await client.from("shots").upsert(shots);
    if (error) throw new Error(error.message);
  }

  const jobs = [...store.jobs.values()].filter((job) => job.series_id === seriesId);
  if (jobs.length > 0) {
    const { error } = await client.from("generation_jobs").upsert(jobs);
    if (error) throw new Error(error.message);
  }

  const ledger = store.ledger.filter((row) => row.series_id === seriesId);
  if (ledger.length > 0) {
    const { error } = await client.from("project_ledger").upsert(ledger);
    if (error) throw new Error(error.message);
  }

  const moderation = store.moderation.filter((row) => row.series_id === seriesId);
  if (moderation.length > 0) {
    const { error } = await client.from("moderation_decisions").upsert(moderation);
    if (error) throw new Error(error.message);
  }

  if (assets && assets.length > 0) {
    const { error } = await client.from("assets").upsert(
      assets.map((asset) => ({
        id: asset.id,
        owner_id: asset.owner_id,
        series_id: asset.series_id,
        actor_id: asset.actor_id ?? null,
        kind: asset.kind,
        bucket: asset.bucket,
        storage_path: asset.storage_path,
        mime_type: asset.mime_type,
        bytes: asset.bytes,
        checksum: asset.checksum,
        metadata: asset.metadata,
        created_at: asset.created_at,
        deleted_at: asset.deleted_at,
      })),
    );
    if (error) throw new Error(error.message);
  }

  const { error: spendError } = await client.from("spend_controls").upsert({
    id: "global",
    daily_cap: store.dailyCap,
    daily_spent: store.dailySpend,
    spent_on: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  });
  if (spendError) throw new Error(spendError.message);
}

export function hydrateAssetStore(
  assets: HttpAssetStore,
  rows: readonly Asset[],
): void {
  assets.hydrate(rows);
}
