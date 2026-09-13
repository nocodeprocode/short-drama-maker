import { getAccessToken, refreshSession } from "./session.ts";

const API_URL =
  import.meta.env.VITE_API_URL ??
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? body.reason ?? `Request failed (${status})`));
    this.name = "ApiError";
  }
}

async function authorizedFetch(path: string, init: RequestInit, token: string | null) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { error: response.ok ? "Invalid response" : `Request failed (${response.status})` };
    }
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  let response = await authorizedFetch(path, init, token);
  if (response.status === 401) {
    const session = await refreshSession();
    token = session?.access_token ?? getAccessToken();
    if (token) response = await authorizedFetch(path, init, token);
  }
  return readJson<T>(response);
}

export async function publicApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return readJson<T>(await authorizedFetch(path, init, null));
}

export const studio = {
  me: () => api<Me>("/me"),
  home: () => api<Home>("/home"),
  account: () => api<Account>("/account"),
  estimate: (sku: number, priority = "balanced", length = "60_90", videoTier = "pro") =>
    api<Estimate>(`/estimate?sku=${sku}&priority=${priority}&length=${length}&video_tier=${videoTier}`),
  moderate: (text: string) =>
    api<{ allowed: boolean; reason: string | null }>("/moderation/check", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  storyIdea: (body: { hint?: string; category?: string; lead?: string; opposite?: string; setting?: string } = {}) =>
    api<StoryIdea>("/story-ideas", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  adaptScript: (text: string) =>
    api<AdaptedScript>("/story-scripts", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  series: () => api<{ items: SeriesCard[] }>("/series"),
  seriesOne: (id: string) => api<SeriesDetail>(`/series/${id}`),
  seriesEpisodes: (id: string) => api<{ items: Episode[] }>(`/series/${id}/episodes`),
  seriesCharacters: (id: string) => api<{ items: Character[] }>(`/series/${id}/characters`),
  approvePilot: (id: string) => api<{ ok: boolean }>(`/series/${id}/approve-pilot`, { method: "POST" }),
  discardSeries: (id: string) => api<{ ok: boolean }>(`/series/${id}`, { method: "DELETE" }),
  productions: (status?: string) =>
    api<{ items: Production[] }>(status ? `/productions?status=${status}` : "/productions"),
  production: (id: string) => api<ProductionDetail>(`/productions/${id}`),
  createProduction: (body: Record<string, unknown>) =>
    api<Production & { checkout?: { id: string; url: string }; paid_from?: string }>("/productions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  loadCredits: (amount: number, paths?: { success?: string; cancel?: string }) =>
    api<{ id: string; url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        sku: "credit",
        amount,
        success_path: paths?.success,
        cancel_path: paths?.cancel,
      }),
    }),
  confirmTestCredit: (amount: number) =>
    api<{ ok: boolean; credit_balance: number; amount: number }>("/billing/confirm-test", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  pause: (id: string) => api<Production>(`/productions/${id}/pause`, { method: "POST", body: "{}" }),
  resume: (id: string) => api<Production>(`/productions/${id}/resume`, { method: "POST", body: "{}" }),
  useBest: (id: string) => api<Production>(`/productions/${id}/use-best`, { method: "POST", body: "{}" }),
  cancel: (id: string) => api<Production>(`/productions/${id}/cancel`, { method: "POST", body: "{}" }),
  regenerateShot: (shotId: string, seriesId: string) =>
    api<{ task_id: string; status: string; deduplicated?: boolean }>(`/shots/${shotId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ series_id: seriesId }),
    }),
  reviewTake: (shotId: string, body: { series_id: string; asset_id: string; decision: "approve" | "reject"; note?: string }) =>
    api<{ task_id: string; status: string }>(`/shots/${shotId}/review`, { method: "POST", body: JSON.stringify(body) }),
  recutEpisode: (episodeId: string) =>
    api<{ task_id: string; status: string; deduplicated?: boolean }>(`/episodes/${episodeId}/recut`, { method: "POST", body: "{}" }),
  confirmTest: (id: string) => api<Production>(`/productions/${id}/confirm-test`, { method: "POST", body: "{}" }),
  checkout: (body: {
    sku: number | "topup" | "credit";
    series_id?: string;
    production_id?: string;
    priority?: string;
    episode_length?: string;
    video_tier?: string;
    amount?: number;
    email?: string;
  }) =>
    api<{ id: string; url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  accept: () => api<{ ok: boolean }>("/me/accept", { method: "POST", body: "{}" }),
  signup: (body: { email: string; password: string; turnstile_token?: string; accept?: boolean }) =>
    publicApi<{ ok: boolean }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  recover: (body: { email: string; turnstile_token?: string }) =>
    publicApi<{ ok: boolean }>("/auth/recover", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  billing: () => api<Billing>("/billing"),
  portal: () =>
    api<{ url: string }>("/billing/portal", {
      method: "POST",
      body: "{}",
    }),
  episode: (id: string) => api<EpisodeDetail>(`/episodes/${id}`),
  character: (id: string) => api<Character & { series_title?: string }>(`/characters/${id}`),
  castCharacter: (id: string, actor_id: string) =>
    api<Character>(`/characters/${id}/cast`, {
      method: "POST",
      body: JSON.stringify({ actor_id }),
    }),
  actors: () => api<{ items: Actor[]; tags: string[] }>("/actors"),
  actor: (id: string) => api<ActorDetail>(`/actors/${id}`),
  createActor: (body: {
    name: string;
    description?: string;
    tags?: string[];
    /** The show being cast, so the face job lands on its task trail. */
    series_id?: string;
    likeness_confirmed?: boolean;
    seed_base64?: string;
    seed_mime_type?: string;
  }) =>
    api<Actor>("/actors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateActor: (
    id: string,
    body: {
      name?: string;
      tags?: string[];
      notes?: string;
      description?: string;
      default_wardrobe?: string;
      identity_fidelity?: "faithful" | "idealized";
    },
  ) => api<Actor>(`/actors/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteActor: (id: string) => api<{ ok: boolean }>(`/actors/${id}`, { method: "DELETE" }),
  regenerateActor: (id: string, body: { kinds?: string[]; series_id?: string } = {}) =>
    api<Actor>(`/actors/${id}/regenerate`, { method: "POST", body: JSON.stringify(body) }),
  replaceActorPhoto: (
    id: string,
    body: { seed_base64: string; seed_mime_type?: string; likeness_confirmed: boolean; series_id?: string },
  ) => api<Actor>(`/actors/${id}/photo`, { method: "POST", body: JSON.stringify(body) }),
  seriesCast: (id: string) => api<CastSheet>(`/series/${id}/cast`),
  seriesDesign: (id: string) => api<DesignSheet>(`/series/${id}/design`),
  addLocation: (seriesId: string, body: { name: string; note?: string }) =>
    api<DesignLocation>(`/series/${seriesId}/locations`, { method: "POST", body: JSON.stringify(body) }),
  addProp: (seriesId: string, body: { name: string; note?: string }) =>
    api<DesignProp>(`/series/${seriesId}/props`, { method: "POST", body: JSON.stringify(body) }),
  renameDesign: (seriesId: string, bucket: "locations" | "props", id: string, body: { name?: string; note?: string }) =>
    api<DesignLocation | DesignProp>(`/series/${seriesId}/${bucket}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  removeDesign: (seriesId: string, bucket: "locations" | "props", id: string) =>
    api<{ ok: boolean }>(`/series/${seriesId}/${bucket}/${id}`, { method: "DELETE" }),
  buildDesign: (seriesId: string, bucket: "locations" | "props", id: string, body: { force?: boolean } = {}) =>
    api<{ task_id: string; status: string }>(`/series/${seriesId}/${bucket}/${id}/generate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  buildMissingDesign: (seriesId: string, bucket: "locations" | "props") =>
    api<{ queued: number }>(`/series/${seriesId}/${bucket}/generate`, { method: "POST", body: "{}" }),
  /** Point one of a show's rooms or objects at something already in the library. */
  useLibraryEntry: (seriesId: string, bucket: "locations" | "props", rowId: string, entryId: string) =>
    api<{ ok: boolean }>(`/series/${seriesId}/${bucket}/${rowId}/use`, {
      method: "POST",
      body: JSON.stringify({ entry_id: entryId }),
    }),
  seriesReadiness: (id: string) => api<Readiness>(`/series/${id}/readiness`),
  /** A show before it is paid for. The run is bought later, from the show page. */
  createDraft: (body: {
    title: string;
    description: string;
    sku?: number;
    episode_length?: string;
    video_tier?: string;
    series_id?: string;
    script_text?: string;
  }) => api<{ id: string; title: string }>("/series", { method: "POST", body: JSON.stringify(body) }),

  places: () => api<{ items: PlaceEntry[]; tags: string[] }>("/places"),
  place: (id: string) => api<PlaceEntry>(`/places/${id}`),
  createPlace: (body: { name: string; notes?: string; tags?: string[]; image_base64?: string; image_mime_type?: string }) =>
    api<PlaceEntry>("/places", { method: "POST", body: JSON.stringify(body) }),
  updatePlace: (id: string, body: { name?: string; notes?: string; tags?: string[] }) =>
    api<PlaceEntry>(`/places/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePlace: (id: string) => api<{ ok: boolean }>(`/places/${id}`, { method: "DELETE" }),
  buildPlace: (id: string) => api<PlaceEntry>(`/places/${id}/generate`, { method: "POST", body: "{}" }),
  uploadPlaceImage: (id: string, body: { image_base64: string; image_mime_type?: string }) =>
    api<PlaceEntry>(`/places/${id}/image`, { method: "POST", body: JSON.stringify(body) }),

  objects: () => api<{ items: ObjectEntry[]; tags: string[] }>("/objects"),
  object: (id: string) => api<ObjectEntry>(`/objects/${id}`),
  createObject: (body: { name: string; notes?: string; tags?: string[]; image_base64?: string; image_mime_type?: string }) =>
    api<ObjectEntry>("/objects", { method: "POST", body: JSON.stringify(body) }),
  updateObject: (id: string, body: { name?: string; notes?: string; tags?: string[]; state?: string }) =>
    api<ObjectEntry>(`/objects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteObject: (id: string) => api<{ ok: boolean }>(`/objects/${id}`, { method: "DELETE" }),
  buildObject: (id: string) => api<ObjectEntry>(`/objects/${id}/generate`, { method: "POST", body: "{}" }),
  uploadObjectImage: (id: string, body: { image_base64: string; image_mime_type?: string }) =>
    api<ObjectEntry>(`/objects/${id}/image`, { method: "POST", body: JSON.stringify(body) }),
  castRole: (
    seriesId: string,
    body: { slot_id?: string; role_name?: string; actor_id?: string | null; role_note?: string; character_id?: string },
  ) => api<CastSlot>(`/series/${seriesId}/cast`, { method: "POST", body: JSON.stringify(body) }),
  uncastRole: (seriesId: string, slotId: string) =>
    api<{ ok: boolean }>(`/series/${seriesId}/cast/${slotId}`, { method: "DELETE" }),
  generateCast: (seriesId: string, body: { slot_ids?: string[] } = {}) =>
    api<{ generated: number; naming?: boolean; items: CastSlot[] }>(`/series/${seriesId}/cast/generate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  attention: () => api<{ items: AttentionItem[]; activity: AttentionActivity[] }>("/attention"),
};

export type Me = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  beta: boolean;
  stripe_customer_id: string | null;
  accepted_at: string | null;
};

export type BillingReceipt = {
  id: string;
  amount: number;
  created_at: string;
  series_id: string | null;
  series_title: string | null;
};

export type BillingSku = {
  sku: number | "topup" | "credit";
  episode_count: number;
  retail: number;
  is_pilot?: boolean;
  finished_runtime_label?: string;
  video_tier?: "pro" | "catalog";
};

export type Billing = {
  email: string;
  slots_used: number;
  slots_total: number;
  stripe_customer_id: string | null;
  last_payment: BillingReceipt | null;
  receipts: BillingReceipt[];
  series: Array<{
    id: string;
    title: string;
    target_episode_count?: number;
    episode_length?: string;
    video_tier?: "pro" | "catalog";
    started?: boolean;
  }>;
  skus: BillingSku[];
  topup: BillingSku;
  credit_balance: number;
  credit_presets: number[];
};

export type Account = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  slots_used: number;
  slots_total: number;
  credit_balance?: number;
};

export type Estimate = {
  sku: number | string;
  episode_count: number;
  retail: number;
  is_pilot?: boolean;
  finished_runtime_label?: string;
  run_time_label?: string;
  length_label?: string;
  estimated_min?: number;
  estimated_max?: number;
};

export type StoryIdea = {
  title: string;
  brief: string;
  category: string;
};

export type AdaptedScript = {
  title: string;
  brief: string;
  source_language: string;
  source_language_name: string;
};

export type SeriesCard = {
  id: string;
  title: string;
  status: string;
  sku: string | null;
  poster_tone: string;
  cover_url?: string | null;
  pilot_approved: boolean;
  created_at: string;
};

export type CharacterRef = {
  kind: string;
  url: string;
  label: string;
};

export type CharacterLook = {
  look: string;
  url: string;
  label: string;
};

export type Character = {
  id: string;
  series_id: string;
  name: string;
  description: string;
  locked: boolean;
  appearance_locked?: boolean;
  voice_locked?: boolean;
  voice_description?: string;
  actor_id?: string | null;
  actor_name?: string | null;
  still_url?: string | null;
  refs?: CharacterRef[];
  wardrobe?: CharacterLook[];
  voice_url?: string | null;
  series_title?: string;
};

export type ActorStatus = "idle" | "queued" | "running" | "failed" | "ready";

export type Actor = {
  id: string;
  name: string;
  source: "generated" | "likeness";
  tags: string[];
  notes: string;
  description?: string;
  default_wardrobe?: string;
  identity_fidelity?: "faithful" | "idealized";
  judge_notes?: string | null;
  seed_url?: string | null;
  still_url: string | null;
  refs: CharacterRef[];
  /** Titles this face has already played in. */
  shows: string[];
  /** False while the face pack is still being generated. */
  ready: boolean;
  status?: ActorStatus;
  error?: string | null;
  progress?: { done: number; total: number };
  created_at: string;
};

/** One part on a show and who plays it. */
export type CastSlot = {
  id: string;
  series_id: string;
  role_name: string | null;
  display_name: string;
  role_note: string;
  job: "engine" | "wall" | "witness" | "nuke" | null;
  job_label: string | null;
  archetype: string;
  importance: "lead" | "supporting" | "background";
  castable: boolean;
  named: boolean;
  suggested_name: string | null;
  suggested_gender: "woman" | "man" | null;
  origin: "slate" | "buyer";
  actor_id: string | null;
  actor_name: string | null;
  actor_source: "generated" | "likeness" | null;
  actor_still_url: string | null;
  actor_status?: ActorStatus | null;
  actor_error?: string | null;
  actor_progress?: { done: number; total: number } | null;
  character_id: string | null;
  character_still_url: string | null;
  locked: boolean;
  mode: "actor" | "generate";
};

export type CastSheet = {
  series_id: string;
  series_title: string;
  items: CastSlot[];
  /** Roles the story has written, whether cast or not. */
  roles: Character[];
  /** Written roles with no cast slot yet. */
  unclaimed: Character[];
  roster: Actor[];
  slate_ready?: boolean;
  naming?: boolean;
  story_written: boolean;
};

export type DesignStatus = "planned" | "building" | "ready" | "failed";

/** A room we shoot in. Its plate is the only legal version of that room. */
export type DesignLocation = {
  id: string;
  series_id: string;
  name: string;
  note: string;
  origin: "slate" | "buyer" | "story";
  position: number;
  plate_url: string | null;
  /** Lighting note from the plate; every close-up in this room carries it. */
  lighting_lock: string | null;
  /** Every wall plus overhead of the same empty set, built with the plate. */
  angles: Array<{ angle: string; url: string }>;
  status: DesignStatus;
  locked: boolean;
  error: string | null;
};

/** An object the plot turns on, shot alone so it stays the same object. */
export type DesignProp = {
  id: string;
  series_id: string;
  name: string;
  note: string;
  origin: "slate" | "buyer" | "story" | "cast_device";
  position: number;
  still_url: string | null;
  /** Extra faces of the same object when it has a back or an open state. */
  angles: Array<{ angle: string; url: string }>;
  kind: string | null;
  state: string | null;
  status: DesignStatus;
  locked: boolean;
  error: string | null;
  cast_slot_id: string | null;
};

/**
 * The owner's catalog of places and objects, reusable across shows the way a
 * face is. A show's own row points at one of these once it is used.
 */
export type PlaceEntry = {
  id: string;
  name: string;
  source: "generated" | "upload";
  notes: string;
  tags: string[];
  image_url: string | null;
  /** The buyer's original upload, if they brought their own picture. */
  seed_url: string | null;
  lighting_lock: string | null;
  status: DesignStatus;
  error: string | null;
  /** Titles already shooting here, so a used entry is not deleted by accident. */
  shows: string[];
  ready: boolean;
  created_at: string;
};

export type ObjectEntry = {
  id: string;
  name: string;
  source: "generated" | "upload";
  notes: string;
  tags: string[];
  image_url: string | null;
  seed_url: string | null;
  kind: string | null;
  state: string | null;
  status: DesignStatus;
  error: string | null;
  shows: string[];
  ready: boolean;
  created_at: string;
};

/** How much of one group of things exists, and what is still missing. */
export type ReadyGroup = { done: number; total: number; missing: string[] };

/**
 * What has to exist before a show can be shot. The server decides this; the
 * start button only reflects it.
 */
export type Readiness = {
  series_id: string;
  story_written: boolean;
  cast: ReadyGroup;
  places: ReadyGroup;
  objects: ReadyGroup;
  /** Parts with no name or gender yet, so no face can be generated for them. */
  unnamed: number;
  can_start: boolean;
  blocking: string[];
};

export type DesignSheet = {
  series_id: string;
  series_title: string;
  locations: DesignLocation[];
  props: DesignProp[];
  story_written: boolean;
};

export type ActorAppearance = {
  character_id: string;
  series_id: string;
  series_title: string;
  role: string;
  locked: boolean;
};

export type ActorDetail = Actor & {
  appearances: ActorAppearance[];
};

export type Episode = {
  id: string;
  series_id: string;
  episode_number: number;
  title: string;
  status: string;
  poster_tone?: string;
  cover_url?: string | null;
  duration_seconds?: number | null;
  final_url?: string | null;
  updated_at?: string;
};

export type SeriesDetail = SeriesCard & {
  description?: string;
  story_bible?: {
    title?: string;
    logline?: string;
    characters?: Array<{ name: string; role?: string; description?: string }>;
    locations?: string[];
    episode_structure?: Array<{ episode_number: number; title: string; hook?: string }>;
  } | null;
  characters: Character[];
  productions: Production[];
  episode_count: number;
  pilot_required: boolean;
  paid?: boolean;
  next_action?: "pay_pilot" | "continue_draft" | "open_production" | "approve_pilot" | "buy_next_block";
  active_production_id?: string | null;
  target_episode_count?: number;
  can_discard?: boolean;
  episode_length?: string;
  video_tier?: "pro" | "catalog";
};

export type AttentionItem = {
  id: string;
  production_id: string;
  series_id: string;
  series_title: string;
  kind: "technical" | "quality" | "policy" | "decision";
  title: string;
  detail: string;
  primary_action: "retry" | "use_best" | "open";
  href: string;
};

export type AttentionActivity = {
  id: string;
  production_id: string;
  series_title: string;
  state: "watching" | "issue" | "fixing" | "resolved" | "cutting" | "ready";
  title: string;
  detail: string;
  href: string;
};

export type Production = {
  id: string;
  series_id: string;
  series_title?: string;
  poster_tone?: string;
  mode: string;
  sku: string;
  video_tier?: "pro" | "catalog";
  priority: string;
  episode_length: string;
  episode_start: number;
  episode_end: number;
  status: string;
  ui_phase: string;
  intervention_type: string | null;
  intervention?: Record<string, unknown>;
  agent_decision: string | null;
  paid_amount: number;
  paused: boolean;
  created_at: string;
  updated_at: string;
  estimate?: Estimate | null;
  status_label?: string;
  phase_label?: string;
  headline?: string;
  progress?: number;
  cover_url?: string | null;
};

export type ProductionTask = {
  id: string;
  action: string;
  status: string;
  error_code: string | null;
  title?: string;
  detail?: string;
  status_label?: string;
  subject?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProductionAsset = {
  id: string;
  kind: string;
  mime: string;
  url: string;
  label: string;
  created_at: string;
};

export type ProductionShoot = {
  id: string;
  label: string;
  status: string;
  episode_number: number | null;
  shot_position?: number;
  title?: string;
};

export type ProductionCharacter = {
  id: string;
  name: string;
  description: string;
  locked: boolean;
  still_url: string | null;
  voice_url: string | null;
  still_asset_id?: string | null;
  voice_asset_id?: string | null;
  has_appearance: boolean;
  has_voice: boolean;
};

export type ProductionDetail = Production & {
  episodes: Episode[];
  tasks: ProductionTask[];
  characters?: ProductionCharacter[];
  assets?: ProductionAsset[];
  shoots?: ProductionShoot[];
  current_step?: ProductionTask | null;
  balance: number;
  /** Settled provider spend on this series to date. */
  spent?: number;
  story_bible?: { logline?: string } | null;
};

export type Home = {
  display_name: string;
  status_sentence: string;
  in_flight_episodes: number;
  blocked: {
    production_id: string;
    series_title: string;
    episode: number;
    type: string | null;
    message: string;
  } | null;
  ready_to_publish: Array<Episode & { series_title?: string }>;
  in_production: Production[];
  series: SeriesCard[];
};

export type EpisodeDetail = Episode & {
  series_title?: string;
  production_id?: string | null;
  production_mode?: string | null;
  captions_url?: string | null;
  scenes: Array<{ id: string; position: number; location: string; status: string }>;
  shots: Array<{
    id: string;
    scene_id: string;
    position: number;
    status: string;
    selected_generation_id?: string | null;
    shot_data: Record<string, unknown>;
    video_url?: string | null;
    still_url?: string | null;
  }>;
};
