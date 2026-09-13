export function usd(amount: number | string | null | undefined): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function usdLabel(amount: number | string | null | undefined): string {
  return usd(amount).toFixed(2);
}

const ACTION_LABELS: Record<string, string> = {
  analyze: "Write the story bible",
  generate_appearance: "Create character stills",
  generate_actor: "Create the actor stills",
  generate_wardrobe: "Create the wardrobe looks",
  design_voice: "Design the voice",
  lock_character: "Lock face and voice",
  lock_locations: "Lock recurring locations",
  generate_cover: "Create the series cover",
  create_episode: "Open the next episode",
  plan_episode: "Plan the episode",
  generate_dialogue: "Record dialogue",
  generate_video: "Shoot the scene",
  regenerate_shot: "Reshoot the scene",
  render_episode: "Cut the episode",
  advance_production: "Move production forward",
  waiting: "Waiting to start",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Shooting",
  generating: "Shooting",
  paused: "Paused",
  awaiting_payment: "Waiting for payment",
  needs_user: "Needs you",
  needs_you: "Needs you",
  ready: "Ready",
  complete: "Ready",
  failed: "Stopped",
  done: "Done",
  cancelled: "Cancelled",
  draft: "Draft",
  completed: "Ready",
  preparing: "Queued",
  producing: "Shooting",
  finishing: "Shooting",
};

const PHASE_COPY: Record<string, string> = {
  preparing: "Preparing the cast and the story",
  producing: "Shooting and cutting episodes",
  finishing: "Finishing the cut",
  needs_you: "Waiting for a decision from you",
  ready: "Ready to watch",
};

export function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "Production step";
  return ACTION_LABELS[action] ?? titleCase(action.replaceAll("_", " "));
}

export function statusLabel(status: string | null | undefined, paused = false): string {
  if (paused && (status === "running" || status === "queued" || status === "generating")) return "Paused";
  if (!status) return "Shooting";
  return STATUS_LABELS[status] ?? titleCase(status.replaceAll("_", " "));
}

export function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Preparing the run";
  return PHASE_COPY[phase] ?? titleCase(phase.replaceAll("_", " "));
}

export function activityDetail(task: { status: string; error_code?: string | null }): string {
  if (task.status === "dead_lettered") return `${task.error_code ?? "This step kept failing."} Retries are exhausted; resume the production to try again.`;
  if (task.status === "failed" || task.error_code) return String(task.error_code ?? "This step did not finish.");
  if (task.status === "done" || task.status === "completed") return "Done";
  if (task.status === "running") return "Working now";
  if (task.status === "queued") return "Up next";
  return statusLabel(task.status);
}

export function progressForPhase(phase: string | null | undefined, status: string | null | undefined): number {
  if (status === "ready" || phase === "ready") return 100;
  if (status === "needs_user" || phase === "needs_you") return 62;
  if (phase === "finishing") return 85;
  if (phase === "producing") return 55;
  if (phase === "preparing") return 22;
  return 12;
}

export type SeriesNextAction = "pay_pilot" | "continue_draft" | "open_production" | "approve_pilot" | "buy_next_block";

export function seriesNextAction(input: {
  pilot_approved: boolean;
  productions: Array<{ id: string; status: string; paid_amount: number | string; sku?: string | number }>;
}): { next_action: SeriesNextAction; active_production_id: string | null } {
  const live = input.productions.filter((row) => row.status !== "cancelled");
  const paid = live.filter((row) => Number(row.paid_amount) > 0 || row.status !== "awaiting_payment");
  const active =
    paid.find((row) => row.status === "needs_user") ??
    paid.find((row) => row.status === "running" || row.status === "queued") ??
    paid.find((row) => row.status === "ready") ??
    paid[0] ??
    null;
  if (!active) {
    const unpaid = live.find((row) => row.status === "awaiting_payment");
    if (unpaid) return { next_action: "continue_draft", active_production_id: unpaid.id };
    return { next_action: "pay_pilot", active_production_id: null };
  }
  const startedLongRun = paid.some((row) => {
    const sku = Number(row.sku);
    return Number.isFinite(sku) && sku !== 2;
  });
  if (active.status === "ready" && !input.pilot_approved && !startedLongRun) {
    return { next_action: "approve_pilot", active_production_id: active.id };
  }
  if (active.status === "ready") {
    return { next_action: "buy_next_block", active_production_id: active.id };
  }
  return { next_action: "open_production", active_production_id: active.id };
}

export function attentionKind(type: string | null | undefined): "technical" | "quality" | "policy" | "decision" {
  if (type === "content_policy") return "policy";
  if (type === "quality_budget") return "quality";
  if (type === "technical" || type === "provider_unavailable") return "technical";
  return "decision";
}

export function interventionMessage(
  type: string | null | undefined,
  decision: string | null | undefined,
  extra?: string | null,
): string {
  if (extra) return extra;
  if (decision) return decision;
  if (type === "technical" || type === "provider_unavailable") return "A production step failed and needs a retry.";
  if (type === "quality_budget") return "This run stopped below your quality bar after several attempts.";
  if (type === "content_policy") return "This scene cannot be generated.";
  return "This show needs a decision from you.";
}

export function sortShotVideoRows<T extends { metadata?: Record<string, unknown> | null }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const le = Number(left.metadata?.episode_number ?? 0);
    const ls = Number(left.metadata?.shot_position ?? 0);
    const re = Number(right.metadata?.episode_number ?? 0);
    const rs = Number(right.metadata?.shot_position ?? 0);
    return (Number.isFinite(le) ? le : 0) - (Number.isFinite(re) ? re : 0)
      || (Number.isFinite(ls) ? ls : 0) - (Number.isFinite(rs) ? rs : 0);
  });
}

export function headlineFor(row: {
  status: string;
  paused: boolean;
  ui_phase: string;
  agent_decision: string | null;
}): string {
  if (row.status === "awaiting_payment") return "Waiting for payment to clear.";
  if (row.paused) return "This show is paused. Resume when you want it to continue.";
  if (row.agent_decision) return row.agent_decision;
  return phaseLabel(row.ui_phase);
}

export const STILL_KIND_ORDER = ["front", "three_quarter", "profile", "full_body", "default_wardrobe"] as const;

const STILL_KIND_LABELS: Record<string, string> = {
  front: "Front",
  three_quarter: "Three-quarter",
  profile: "Profile",
  full_body: "Full body",
  default_wardrobe: "Everyday",
};

export function stillKindLabel(kind: string): string {
  if (kind.startsWith("look:")) {
    return kind.slice(5).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return STILL_KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

export function stillAssetIds(visual: Record<string, unknown> | null | undefined): string[] {
  return stillRefEntries(visual).map((item) => item.id);
}

export function stillRefEntries(visual: Record<string, unknown> | null | undefined): Array<{ kind: string; id: string }> {
  const refs = (visual?.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
  const wardrobe = (visual?.wardrobe_asset_ids ?? {}) as Record<string, unknown>;
  const face = STILL_KIND_ORDER.flatMap((kind) => {
    const id = refs[kind];
    return typeof id === "string" && id ? [{ kind, id }] : [];
  });
  const extra = Object.entries(refs).flatMap(([kind, id]) => {
    if ((STILL_KIND_ORDER as readonly string[]).includes(kind)) return [];
    return typeof id === "string" && id ? [{ kind, id }] : [];
  });
  const looks = Object.entries(wardrobe).flatMap(([look, id]) =>
    typeof id === "string" && id ? [{ kind: `look:${look}`, id }] : [],
  );
  return [...face, ...extra, ...looks];
}
