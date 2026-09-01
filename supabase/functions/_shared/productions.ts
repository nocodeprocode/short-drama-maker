import { json, serviceClient } from "./auth.ts";
import { wakeJobs } from "./jobs.ts";
import { headlineFor, phaseLabel, progressForPhase, statusLabel, usd } from "./present.ts";
import {
  estimateBlock,
  isBlockSku,
  isEpisodeLength,
  isPriority,
  isSeasonSku,
  nextEpisodeRange,
  posterTone,
  type BlockSku,
  type EpisodeLength,
  type ProductionPriority,
} from "./skus.ts";

/** Must match src/engine/config/models.ts PRICE_SNAPSHOT_VERSION and a row in price_snapshots. */
export const PRICE_SNAPSHOT_VERSION = "2026-08-31.v1-720p";

export type Service = ReturnType<typeof serviceClient>;

export type ProductionRow = {
  id: string;
  owner_id: string;
  series_id: string;
  mode: string;
  sku: string;
  priority: string;
  episode_length: string;
  notify: string;
  episode_start: number;
  episode_end: number;
  status: string;
  ui_phase: string;
  intervention_type: string | null;
  intervention: Record<string, unknown>;
  agent_decision: string | null;
  stripe_checkout_id: string | null;
  paid_amount: number;
  paused: boolean;
  created_at: string;
  updated_at: string;
};

export async function ownedSeries(
  supabase: Service,
  userId: string,
  seriesId: string | undefined,
  isAdmin: boolean,
) {
  if (!seriesId) return null;
  let query = supabase.from("series").select("*").eq("id", seriesId);
  if (!isAdmin) query = query.eq("owner_id", userId);
  const { data } = await query.maybeSingle();
  return data;
}

export async function seriesBalance(supabase: Service, seriesId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("entry_type, amount")
    .eq("series_id", seriesId);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => {
    const amount = Number(row.amount);
    if (row.entry_type === "purchase" || row.entry_type === "release" || row.entry_type === "adjustment") {
      return sum + amount;
    }
    if (row.entry_type === "reserve" || row.entry_type === "settle") return sum - amount;
    return sum;
  }, 0);
}

export async function enqueue(
  supabase: Service,
  ownerId: string,
  seriesId: string | undefined,
  action: string,
  payload: Record<string, unknown>,
  isAdmin: boolean,
  productionId?: string,
) {
  const series = await ownedSeries(supabase, ownerId, seriesId, isAdmin);
  if (!series) return json({ error: "Series not found" }, 404);
  if (series.owner_id !== ownerId && !isAdmin) return json({ error: "Forbidden" }, 403);

  // Idempotent enqueue: a double-click or a retried request must not queue the
  // same work twice while the first copy is still queued or running.
  const fingerprint = JSON.stringify(payload ?? {});
  const { data: active } = await supabase
    .from("engine_tasks")
    .select("id, status, payload")
    .eq("series_id", series.id)
    .eq("action", action)
    .in("status", ["queued", "running"])
    .limit(50);
  const duplicate = (active ?? []).find((row) => JSON.stringify(row.payload ?? {}) === fingerprint);
  if (duplicate) {
    return json({ task_id: duplicate.id, status: duplicate.status, action, deduplicated: true }, 202);
  }

  const { data, error } = await supabase
    .from("engine_tasks")
    .insert({
      owner_id: series.owner_id,
      series_id: series.id,
      production_id: productionId ?? null,
      action,
      payload,
      status: "queued",
    })
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  await wakeJobs();
  return json({ task_id: data.id, status: "queued", action }, 202);
}

export function publicCharacter(row: Record<string, unknown>) {
  const voice = (row.voice_profile ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    series_id: row.series_id,
    name: row.name,
    description: row.description,
    locked: row.locked,
    appearance_locked: Boolean(row.locked),
    voice_locked: Boolean(voice.locked),
    voice_description: String(voice.design_prompt ?? voice.speaking_style ?? "Natural conversational voice"),
    visual_profile: row.visual_profile,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function publicProduction(row: ProductionRow, extras: Record<string, unknown> = {}) {
  const sku = Number(row.sku);
  const estimate = isSeasonSku(sku)
    ? estimateBlock({
        sku,
        priority: row.priority as ProductionPriority,
        length: row.episode_length as EpisodeLength,
      })
    : null;
  return {
    id: row.id,
    series_id: row.series_id,
    mode: row.mode,
    sku: row.sku,
    priority: row.priority,
    episode_length: row.episode_length,
    notify: row.notify,
    episode_start: row.episode_start,
    episode_end: row.episode_end,
    status: row.status,
    ui_phase: row.ui_phase,
    intervention_type: row.intervention_type,
    intervention: row.intervention,
    agent_decision: row.agent_decision,
    paid_amount: usd(row.paid_amount),
    paused: row.paused,
    created_at: row.created_at,
    updated_at: row.updated_at,
    estimate,
    status_label: statusLabel(row.status, row.paused),
    phase_label: phaseLabel(row.ui_phase),
    headline: headlineFor(row),
    progress: progressForPhase(row.ui_phase, row.status),
    ...extras,
  };
}

export async function createProductionRecord(
  supabase: Service,
  input: {
    ownerId: string;
    series: { id: string; owner_id: string; pilot_approved_at?: string | null };
    mode: "autopilot" | "studio";
    sku: BlockSku;
    priority: ProductionPriority;
    length: EpisodeLength;
    notify: string;
  },
) {
  if (!input.series.pilot_approved_at && input.sku !== 2) {
    return { error: "New series start with a 2-episode pilot.", status: 400 as const };
  }
  const { count } = await supabase
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("series_id", input.series.id);
  const range = nextEpisodeRange(count ?? 0, input.sku);
  const estimate = estimateBlock({
    sku: input.sku,
    priority: input.priority,
    length: input.length,
  });
  const { data, error } = await supabase
    .from("productions")
    .insert({
      owner_id: input.series.owner_id,
      series_id: input.series.id,
      mode: input.mode,
      sku: String(input.sku),
      priority: input.priority,
      episode_length: input.length,
      notify: input.notify,
      episode_start: range.start,
      episode_end: range.end,
      status: "awaiting_payment",
      ui_phase: "preparing",
    })
    .select()
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create production", status: 400 as const };
  return { production: data as ProductionRow, estimate, status: 201 as const };
}

export function parseProductionBody(body: Record<string, unknown>) {
  const sku = body.sku ?? body.episodes;
  const priority = body.priority ?? "balanced";
  const length = body.episode_length ?? body.length ?? "60_90";
  const mode = body.mode === "studio" ? "studio" : "autopilot";
  if (!isBlockSku(sku) && sku !== "topup") {
    return { error: "sku must be 2|12|24|45|60|topup" };
  }
  if (sku !== "topup" && !isPriority(priority)) return { error: "priority must be fast|balanced|quality" };
  if (sku !== "topup" && !isEpisodeLength(length)) {
    return { error: "episode_length must be 30_45|60_90|120_180|900_1080" };
  }
  return {
    sku: sku as BlockSku | "topup",
    priority: priority as ProductionPriority,
    length: length as EpisodeLength,
    mode: mode as "autopilot" | "studio",
    notify: String(body.notify ?? "in_app_email"),
    title: typeof body.title === "string" ? body.title : undefined,
    description: typeof body.description === "string" ? body.description : "",
    series_id: typeof body.series_id === "string" ? body.series_id : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
  };
}

export function seriesPoster(series: { id: string; poster_tone?: string | null }) {
  return series.poster_tone || posterTone(series.id);
}
