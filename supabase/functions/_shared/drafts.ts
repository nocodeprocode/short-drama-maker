import { serviceClient } from "./auth.ts";

export const DRAFT_TTL_DAYS = 14;

export function canDiscardSeries(
  productions: ReadonlyArray<{ paid_amount?: number | string | null }>,
) {
  return !productions.some((row) => Number(row.paid_amount ?? 0) > 0);
}

export function draftCutoffIso(now = new Date()) {
  return new Date(now.getTime() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function discardUnpaidSeries(
  supabase: ReturnType<typeof serviceClient>,
  seriesId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const { data: paid } = await supabase
    .from("productions")
    .select("id")
    .eq("series_id", seriesId)
    .gt("paid_amount", 0)
    .limit(1);
  if ((paid ?? []).length > 0) {
    return { error: "A paid run stays on the account. Cancel the production instead.", status: 409 };
  }
  const now = new Date().toISOString();
  await supabase
    .from("engine_tasks")
    .update({ status: "cancelled", error_code: "draft_discarded", lease_until: null, updated_at: now })
    .eq("series_id", seriesId)
    .in("status", ["queued", "running"]);
  await supabase
    .from("productions")
    .update({
      status: "cancelled",
      paused: true,
      ui_phase: "cancelled",
      agent_decision: "Draft discarded.",
      updated_at: now,
    })
    .eq("series_id", seriesId)
    .in("status", ["awaiting_payment", "queued"]);
  await supabase.from("series").update({ deleted_at: now }).eq("id", seriesId).is("deleted_at", null);
  return { ok: true };
}
