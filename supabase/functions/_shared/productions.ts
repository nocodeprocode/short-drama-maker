import { json, serviceClient } from "./auth.ts";
import { wakeJobs } from "./jobs.ts";
import { headlineFor, phaseLabel, progressForPhase, statusLabel, usd } from "./present.ts";
import {
  estimateBlock,
  isBlockSku,
  isEpisodeLength,
  isPriority,
  isSeasonSku,
  isVideoTier,
  nextEpisodeRange,
  posterTone,
  type BlockSku,
  type EpisodeLength,
  type ProductionPriority,
  type VideoTier,
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
  video_tier?: VideoTier;
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
  let query = supabase.from("series").select("*").eq("id", seriesId).is("deleted_at", null);
  if (!isAdmin) query = query.eq("owner_id", userId);
  const { data } = await query.maybeSingle();
  return data;
}

/** Real provider spend to date: the sum of settled actuals. */
export async function seriesSpent(supabase: Service, seriesId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("amount")
    .eq("series_id", seriesId)
    .eq("entry_type", "settle");
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

function ledgerBalance(rows: Array<{ entry_type: string; amount: number | string }>): number {
  return rows.reduce((sum, row) => {
    const amount = Number(row.amount);
    if (row.entry_type === "purchase" || row.entry_type === "release" || row.entry_type === "adjustment") {
      return sum + amount;
    }
    if (row.entry_type === "reserve" || row.entry_type === "settle") return sum - amount;
    return sum;
  }, 0);
}

export async function seriesBalance(supabase: Service, seriesId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("entry_type, amount")
    .eq("series_id", seriesId);
  if (error) throw new Error(error.message);
  return ledgerBalance(data ?? []);
}

/** Unused studio credit that is not tied to a show. Series leftover stays on that show. */
export async function walletBalance(supabase: Service, ownerId: string): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("entry_type, amount")
    .eq("owner_id", ownerId)
    .is("series_id", null);
  if (error) throw new Error(error.message);
  return ledgerBalance(data ?? []);
}

export async function allocateWalletToSeries(
  supabase: Service,
  input: {
    ownerId: string;
    seriesId: string;
    productionId: string;
    amount: number;
  },
): Promise<{ ok: true } | { error: string }> {
  const eventId = `wallet_alloc_${input.productionId}`;
  const debit = await supabase.from("project_ledger").insert({
    owner_id: input.ownerId,
    series_id: null,
    entry_type: "adjustment",
    amount: -input.amount,
    stripe_event_id: `${eventId}:wallet`,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (debit.error && debit.error.code !== "23505") return { error: debit.error.message };
  const credit = await supabase.from("project_ledger").insert({
    owner_id: input.ownerId,
    series_id: input.seriesId,
    entry_type: "purchase",
    amount: input.amount,
    stripe_event_id: eventId,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (credit.error && credit.error.code !== "23505") return { error: credit.error.message };
  return { ok: true };
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
  const videoTier = isVideoTier(row.video_tier) ? row.video_tier : "pro";
  const estimate = isSeasonSku(sku)
    ? estimateBlock({
        sku,
        priority: row.priority as ProductionPriority,
        length: row.episode_length as EpisodeLength,
        video_tier: videoTier,
      })
    : null;
  return {
    id: row.id,
    series_id: row.series_id,
    mode: row.mode,
    sku: row.sku,
    video_tier: videoTier,
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
    video_tier?: VideoTier;
  },
) {
  const { count } = await supabase
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("series_id", input.series.id);
  const range = nextEpisodeRange(count ?? 0, input.sku);
  const videoTier = input.video_tier ?? "pro";
  const estimate = estimateBlock({
    sku: input.sku,
    priority: input.priority,
    length: input.length,
    video_tier: videoTier,
  });
  if (input.sku !== 2 && !input.series.pilot_approved_at) {
    await supabase
      .from("series")
      .update({ pilot_approved_at: new Date().toISOString() })
      .eq("id", input.series.id);
  }
  const { data, error } = await supabase
    .from("productions")
    .insert({
      owner_id: input.series.owner_id,
      series_id: input.series.id,
      mode: input.mode,
      sku: String(input.sku),
      priority: input.priority,
      episode_length: input.length,
      video_tier: videoTier,
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
  const videoTier = body.video_tier ?? "pro";
  if (!isBlockSku(sku) && sku !== "topup" && sku !== "credit") {
    return { error: "sku must be 2|12|15|24|30|45|50|60|90|topup|credit" };
  }
  if (sku !== "topup" && sku !== "credit" && !isPriority(priority)) {
    return { error: "priority must be fast|balanced|quality" };
  }
  if (sku !== "topup" && sku !== "credit" && !isEpisodeLength(length)) {
    return { error: "episode_length must be 30_45|45_60|60_90|120_180|900_1080" };
  }
  if (sku !== "topup" && sku !== "credit" && !isVideoTier(videoTier)) {
    return { error: "video_tier must be pro|catalog" };
  }
  return {
    sku: sku as BlockSku | "topup" | "credit",
    priority: priority as ProductionPriority,
    length: length as EpisodeLength,
    video_tier: (isVideoTier(videoTier) ? videoTier : "pro") as VideoTier,
    mode: mode as "autopilot" | "studio",
    notify: String(body.notify ?? "in_app_email"),
    title: typeof body.title === "string" ? body.title : undefined,
    description: typeof body.description === "string" ? body.description : "",
    series_id: typeof body.series_id === "string" ? body.series_id : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    amount: typeof body.amount === "number" ? body.amount : undefined,
    // Uploaded at commission time. Bytes travel as base64 in the task payload,
    // the same way actor seed images do, because only the runner can write R2.
    cover_base64: typeof body.cover_base64 === "string" && body.cover_base64 ? body.cover_base64 : undefined,
    cover_mime_type: typeof body.cover_mime_type === "string" ? body.cover_mime_type : undefined,
    script_text: typeof body.script_text === "string" && body.script_text.trim() ? body.script_text : undefined,
  };
}

export function seriesPoster(series: { id: string; poster_tone?: string | null }) {
  return series.poster_tone || posterTone(series.id);
}
