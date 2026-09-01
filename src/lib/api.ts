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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  let response = await authorizedFetch(path, init, token);
  if (response.status === 401) {
    const session = await refreshSession();
    token = session?.access_token ?? getAccessToken();
    if (token) response = await authorizedFetch(path, init, token);
  }
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

export const studio = {
  me: () => api<Me>("/me"),
  home: () => api<Home>("/home"),
  account: () => api<Account>("/account"),
  estimate: (sku: number, priority = "balanced", length = "60_90") =>
    api<Estimate>(`/estimate?sku=${sku}&priority=${priority}&length=${length}`),
  moderate: (text: string) =>
    api<{ allowed: boolean; reason: string | null }>("/moderation/check", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  storyIdea: (body: { hint?: string; category?: string } = {}) =>
    api<StoryIdea>("/story-ideas", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  series: () => api<{ items: SeriesCard[] }>("/series"),
  seriesOne: (id: string) => api<SeriesDetail>(`/series/${id}`),
  seriesEpisodes: (id: string) => api<{ items: Episode[] }>(`/series/${id}/episodes`),
  seriesCharacters: (id: string) => api<{ items: Character[] }>(`/series/${id}/characters`),
  approvePilot: (id: string) => api<{ ok: boolean }>(`/series/${id}/approve-pilot`, { method: "POST" }),
  productions: (status?: string) =>
    api<{ items: Production[] }>(status ? `/productions?status=${status}` : "/productions"),
  production: (id: string) => api<ProductionDetail>(`/productions/${id}`),
  createProduction: (body: Record<string, unknown>) =>
    api<Production & { checkout?: { id: string; url: string } }>("/productions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pause: (id: string) => api<Production>(`/productions/${id}/pause`, { method: "POST", body: "{}" }),
  resume: (id: string) => api<Production>(`/productions/${id}/resume`, { method: "POST", body: "{}" }),
  useBest: (id: string) => api<Production>(`/productions/${id}/use-best`, { method: "POST", body: "{}" }),
  confirmTest: (id: string) => api<Production>(`/productions/${id}/confirm-test`, { method: "POST", body: "{}" }),
  episode: (id: string) => api<EpisodeDetail>(`/episodes/${id}`),
  character: (id: string) => api<Character & { series_title?: string }>(`/characters/${id}`),
  castCharacter: (id: string, actor_id: string) =>
    api<Character>(`/characters/${id}/cast`, {
      method: "POST",
      body: JSON.stringify({ actor_id }),
    }),
  actors: () => api<{ items: Actor[] }>("/actors"),
  actor: (id: string) => api<ActorDetail>(`/actors/${id}`),
  createActor: (body: {
    name: string;
    description?: string;
    likeness_confirmed?: boolean;
    seed_base64?: string;
    seed_mime_type?: string;
  }) =>
    api<Actor>("/actors", {
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
  stripe_customer_id: string | null;
};

export type Account = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  slots_used: number;
  slots_total: number;
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

export type Actor = {
  id: string;
  name: string;
  source: "generated" | "likeness";
  still_url: string | null;
  refs: CharacterRef[];
  created_at: string;
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
  next_action?: "pay_pilot" | "open_production" | "approve_pilot" | "buy_next_block";
  active_production_id?: string | null;
  target_episode_count?: number;
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
  scenes: Array<{ id: string; position: number; location: string; status: string }>;
  shots: Array<{
    id: string;
    scene_id: string;
    position: number;
    status: string;
    shot_data: Record<string, unknown>;
    video_url?: string | null;
    still_url?: string | null;
  }>;
};
