import { classifyTaskFailure, sanitizeTaskError } from "./jobs/errors.ts";

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
  completed: "Ready",
  preparing: "Queued",
  producing: "Shooting",
  finishing: "Shooting",
};

export const CTA = {
  startPilot: "Start a 2-episode pilot",
  startThePilot: "Start the pilot",
  payAndStart: "Pay and start",
  watchLive: "Watch live",
  watchEpisode: (n: number) => `Watch episode ${n}`,
  approveCast: "Approve the cast",
  orderMore: "Order more episodes",
  downloadMp4: "Download MP4",
  openTimeline: "Open timeline",
  useBest: "Use best take",
  retry: "Retry",
  newShow: "New show",
  writeIdea: "Write a new idea",
} as const;

export function greetingName(displayName?: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  if (!first || first.toLowerCase() === "there") return null;
  return first;
}

export function statusBadgeColor(
  status: string | null | undefined,
  paused = false,
): "warning" | "success" | "gray" | "brand" {
  if (paused) return "gray";
  if (status === "needs_user" || status === "needs_you") return "warning";
  if (status === "ready" || status === "complete" || status === "completed") return "success";
  if (status === "awaiting_payment" || status === "paused" || status === "failed" || status === "cancelled") return "gray";
  return "brand";
}

export function nextActionLabel(action: SeriesNextAction | string | null | undefined): string {
  if (action === "pay_pilot") return CTA.startThePilot;
  if (action === "open_production") return CTA.watchLive;
  if (action === "approve_pilot") return CTA.approveCast;
  if (action === "buy_next_block") return CTA.orderMore;
  return CTA.watchLive;
}

export function episodeStripStates(
  episodes: Array<{ episode_number: number; status: string }>,
): Record<number, string> {
  return Object.fromEntries(
    episodes.map((episode) => [
      episode.episode_number,
      episode.status === "complete" || episode.status === "ready"
        ? "done"
        : episode.status === "planned" || episode.status === "queued"
          ? ""
          : "gen",
    ]),
  );
}

export function shotGridCounts(
  items: Array<{ status?: string | null; video_url?: string | null }>,
): { approved: number; generating: number; review: number; queued: number } {
  let approved = 0;
  let generating = 0;
  let review = 0;
  let queued = 0;
  for (const item of items) {
    if (item.status === "complete" || item.status === "ready" || item.video_url) approved += 1;
    else if (item.status === "needs_review" || item.status === "review") review += 1;
    else if (item.status === "generating" || item.status === "running") generating += 1;
    else queued += 1;
  }
  return { approved, generating, review, queued };
}

export function captionCues(
  shots: Array<{ id: string; shot_data: Record<string, unknown> }>,
): Array<{ id: string; who: string; text: string }> {
  return shots
    .map((shot) => {
      const text = typeof shot.shot_data.dialogue === "string" ? shot.shot_data.dialogue.trim() : "";
      if (!text) return null;
      return {
        id: shot.id,
        who: typeof shot.shot_data.speaker === "string" && shot.shot_data.speaker ? shot.shot_data.speaker : "Voice",
        text,
      };
    })
    .filter((cue): cue is { id: string; who: string; text: string } => Boolean(cue));
}

export function assembledEpisodeUrl(finalUrl?: string | null): string | null {
  return finalUrl?.trim() ? finalUrl : null;
}

export function playableShots<T extends { position?: number; video_url?: string | null }>(shots: T[]): T[] {
  return [...shots]
    .filter((shot): shot is T & { video_url: string } => Boolean(shot.video_url))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

export function playableShotUrls(
  shots: Array<{ position?: number; video_url?: string | null }>,
): Array<{ position: number; url: string }> {
  return playableShots(shots).map((shot, index) => ({
    position: shot.position ?? index + 1,
    url: shot.video_url as string,
  }));
}

export function nextCutIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return index + 1 < total ? index + 1 : index;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type HomeShow = {
  id: string;
  title: string;
  poster_tone: string;
  cover_url?: string | null;
  status: string;
  paused: boolean;
  href: string;
  progress?: number;
  episode_start: number;
  episode_end: number;
  ready_count: number;
  headline?: string;
};

export function homeShows(input: {
  series: Array<{
    id: string;
    title: string;
    status: string;
    poster_tone: string;
    cover_url?: string | null;
  }>;
  in_production: Array<{
    id: string;
    series_id: string;
    series_title?: string;
    poster_tone?: string;
    cover_url?: string | null;
    status: string;
    paused: boolean;
    progress?: number;
    ui_phase?: string;
    headline?: string | null;
    agent_decision?: string | null;
    episode_start: number;
    episode_end: number;
  }>;
  ready_to_publish: Array<{
    series_id: string;
    series_title?: string;
    poster_tone?: string;
    cover_url?: string | null;
    episode_number: number;
  }>;
  blocked?: { production_id: string; series_title: string; message: string } | null;
}): HomeShow[] {
  const byId = new Map<string, HomeShow>();

  for (const series of input.series) {
    byId.set(series.id, {
      id: series.id,
      title: series.title,
      poster_tone: series.poster_tone,
      cover_url: series.cover_url,
      status: series.status === "complete" ? "ready" : series.status,
      paused: false,
      href: `/series/${series.id}`,
      episode_start: 1,
      episode_end: 1,
      ready_count: 0,
    });
  }

  const readyBySeries = new Map<string, typeof input.ready_to_publish>();
  for (const episode of input.ready_to_publish) {
    const list = readyBySeries.get(episode.series_id) ?? [];
    list.push(episode);
    readyBySeries.set(episode.series_id, list);
  }

  for (const [seriesId, episodes] of readyBySeries) {
    const numbers = episodes.map((episode) => episode.episode_number);
    const first = episodes[0];
    const current = byId.get(seriesId) ?? {
      id: seriesId,
      title: first?.series_title ?? "Show",
      poster_tone: first?.poster_tone ?? "g1",
      cover_url: first?.cover_url,
      status: "ready",
      paused: false,
      href: `/series/${seriesId}`,
      episode_start: 1,
      episode_end: 1,
      ready_count: 0,
    };
    current.ready_count = episodes.length;
    current.episode_start = Math.min(...numbers);
    current.episode_end = Math.max(...numbers, current.episode_end);
    if (!isLiveShowStatus(current.status, current.paused)) {
      current.status = "ready";
      current.href = `/series/${seriesId}`;
    }
    byId.set(seriesId, current);
  }

  for (const run of input.in_production) {
    const current = byId.get(run.series_id) ?? {
      id: run.series_id,
      title: run.series_title ?? "Show",
      poster_tone: run.poster_tone ?? "g1",
      cover_url: run.cover_url,
      status: run.status,
      paused: run.paused,
      href: `/productions/${run.id}`,
      episode_start: run.episode_start,
      episode_end: run.episode_end,
      ready_count: 0,
    };
    current.status = run.status;
    current.paused = run.paused;
    current.progress = run.progress ?? progressForPhase(run.ui_phase, run.status);
    current.headline = run.headline ?? run.agent_decision ?? undefined;
    current.episode_start = Math.min(current.episode_start, run.episode_start);
    current.episode_end = Math.max(current.episode_end, run.episode_end);
    current.href = `/productions/${run.id}`;
    current.cover_url = current.cover_url ?? run.cover_url;
    byId.set(run.series_id, current);
  }

  if (input.blocked) {
    const live = input.in_production.find((run) => run.id === input.blocked!.production_id);
    const match = (live ? byId.get(live.series_id) : null) ?? [...byId.values()].find((show) => show.title === input.blocked!.series_title);
    if (match) {
      match.status = "needs_user";
      match.headline = input.blocked.message;
      match.href = `/productions/${input.blocked.production_id}`;
    }
  }

  return [...byId.values()].sort((left, right) => showRank(left) - showRank(right) || left.title.localeCompare(right.title));
}

export function isLiveShowStatus(status: string, paused = false): boolean {
  if (paused) return true;
  return status === "needs_user" || status === "running" || status === "queued" || status === "paused";
}

function showRank(show: HomeShow): number {
  if (show.status === "needs_user") return 0;
  if (show.paused || show.status === "paused") return 1;
  if (show.status === "running" || show.status === "queued") return 2;
  if (show.status === "ready") return 3;
  return 4;
}

export function downloadBasename(seriesTitle: string | null | undefined, episodeNumber: number): string {
  const slug = (seriesTitle ?? "episode")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "episode"}-ep-${String(episodeNumber).padStart(2, "0")}`;
}

const PHASE_COPY: Record<string, string> = {
  preparing: "Preparing the cast and the story",
  producing: "Shooting and cutting episodes",
  finishing: "Finishing the cut",
  needs_you: "Waiting for a decision from you",
  ready: "Ready to watch",
};

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

export function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export type CompactLogTask = {
  id: string;
  action: string;
  status: string;
  error_code?: string | null;
  title?: string;
  detail?: string;
  status_label?: string;
  subject?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CompactLogCharacter = {
  id: string;
  name: string;
  has_voice?: boolean;
  voice_url?: string | null;
};

export function compactProductionLog(
  tasks: CompactLogTask[],
  characters: CompactLogCharacter[],
  opts: { hasFinishedShot?: boolean } = {},
): CompactLogTask[] {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  const byId = new Map(characters.map((character) => [character.id, character]));
  const latest = new Map<string, CompactLogTask>();
  for (const task of tasks) {
    if (task.action === "advance_production") continue;
    const key = `${task.action}:${task.subject ?? ""}`;
    const current = latest.get(key);
    if (!current || String(task.updated_at ?? "") > String(current.updated_at ?? "")) {
      const who = task.subject ? names.get(task.subject) : null;
      const character = task.subject ? byId.get(task.subject) : undefined;
      const voiceReady = Boolean(character?.has_voice || character?.voice_url);
      const designLie =
        task.action === "design_voice" &&
        (task.status === "done" || task.status === "completed") &&
        Boolean(character) &&
        !voiceReady;
      const videoLie =
        (task.action === "generate_video" || task.action === "regenerate_shot") &&
        (task.status === "done" || task.status === "completed") &&
        !opts.hasFinishedShot;
      latest.set(key, {
        ...task,
        status: designLie || videoLie ? "running" : task.status,
        status_label: designLie
          ? task.error_code
            ? "Blocked"
            : "Retrying"
          : videoLie
            ? task.error_code
              ? "Blocked"
              : "Shooting"
            : task.status_label,
        title: who ? `${task.title ?? "Production step"} · ${who}` : task.title,
      });
    }
  }
  return [...latest.values()]
    .sort((left, right) => String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? "")))
    .slice(0, 6);
}

export function currentTaskFailure<T extends { status: string; error_code?: string | null }>(
  tasks: T[],
  productionStatus: string,
): T | null {
  const current = tasks.find(
    (task) => (task.status === "queued" || task.status === "running") && Boolean(task.error_code),
  );
  if (current) return current;
  if (productionStatus === "needs_user") {
    return tasks.find((task) => task.status === "failed" && Boolean(task.error_code)) ?? null;
  }
  return null;
}

export function deskActivityCopy(input: {
  status: string;
  ui_phase?: string | null;
  agent_decision?: string | null;
  busyVideo?: boolean;
  hasTakes?: boolean;
}): { state: "watching" | "issue" | "fixing" | "resolved" | "cutting" | "ready"; title: string; detail: string } {
  if (input.status === "needs_user") {
    return {
      state: "issue",
      title: "Issue appeared",
      detail: input.agent_decision ?? "This production needs a decision from you.",
    };
  }
  if (input.status === "ready") {
    return { state: "ready", title: "Ready to watch", detail: input.agent_decision ?? "This run is ready to watch." };
  }
  if (/retry|dropped|busy|outage/i.test(String(input.agent_decision ?? ""))) {
    return {
      state: "fixing",
      title: "Fixing issue",
      detail: input.agent_decision ?? "Retrying this step on the studio.",
    };
  }
  if (input.ui_phase === "producing" && !input.busyVideo && input.hasTakes) {
    return {
      state: "cutting",
      title: "Cutting the episode",
      detail: input.agent_decision ?? "Cutting the episode.",
    };
  }
  return {
    state: "watching",
    title: "Working now",
    detail: input.agent_decision ?? "Production continues on the studio.",
  };
}

export function activityDetail(task: { status: string; error_code?: string | null }): string {
  if (task.status === "failed" || task.error_code) {
    return sanitizeTaskError(task.error_code);
  }
  if (task.status === "done" || task.status === "completed") return "Done";
  if (task.status === "running") return "Working now";
  if (task.status === "queued") return "Up next";
  return statusLabel(task.status);
}

export function listFilterFor(status: string, paused: boolean): "running" | "needs_user" | "ready" | "payment" | "other" {
  if (status === "awaiting_payment") return "payment";
  if (status === "needs_user") return "needs_user";
  if (status === "ready") return "ready";
  if (status === "queued" || status === "running" || paused) return "running";
  return "other";
}

export type SeriesNextAction = "pay_pilot" | "open_production" | "approve_pilot" | "buy_next_block";

export function seriesNextAction(input: {
  pilot_approved: boolean;
  productions: Array<{ id: string; status: string; paid_amount: number | string }>;
}): { next_action: SeriesNextAction; active_production_id: string | null } {
  const live = input.productions.filter((row) => row.status !== "cancelled");
  const paid = live.filter((row) => Number(row.paid_amount) > 0 || row.status !== "awaiting_payment");
  const active =
    paid.find((row) => row.status === "needs_user") ??
    paid.find((row) => row.status === "running" || row.status === "queued") ??
    paid.find((row) => row.status === "ready") ??
    paid[0] ??
    null;
  if (!active) return { next_action: "pay_pilot", active_production_id: null };
  if (active.status === "ready" && !input.pilot_approved) {
    return { next_action: "approve_pilot", active_production_id: active.id };
  }
  if (active.status === "ready" && input.pilot_approved) {
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
  return "This production needs a decision from you.";
}

export function shotVideoSortKey(metadata: Record<string, unknown> | null | undefined): [number, number] {
  const episode = Number(metadata?.episode_number ?? 0);
  const shot = Number(metadata?.shot_position ?? 0);
  return [Number.isFinite(episode) ? episode : 0, Number.isFinite(shot) ? shot : 0];
}

export function sortShotVideoRows<T extends { metadata?: Record<string, unknown> | null }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const [le, ls] = shotVideoSortKey(left.metadata);
    const [re, rs] = shotVideoSortKey(right.metadata);
    return le - re || ls - rs;
  });
}

export function isPlayableFeedKind(kind: string | null | undefined): boolean {
  return kind === "shot_video";
}

export function watchLinksForEpisodes(
  episodes: Array<{ id: string; episode_number: number; status: string }>,
): Array<{ episode_number: number; href: string; label: string }> {
  return [...episodes]
    .filter((episode) => episode.status === "complete")
    .sort((left, right) => left.episode_number - right.episode_number)
    .map((episode) => ({
      episode_number: episode.episode_number,
      href: `/episodes/${episode.id}/studio`,
      label: CTA.watchEpisode(episode.episode_number),
    }));
}

export function studioPlayerMode(input: { video_url?: string | null; status?: string | null }): "player" | "shooting" | "poster" {
  if (input.video_url) return "player";
  if (input.status === "generating") return "shooting";
  return "poster";
}

export function progressForPhase(phase: string | null | undefined, status: string | null | undefined): number {
  if (status === "ready" || phase === "ready") return 100;
  if (status === "needs_user" || phase === "needs_you") return 62;
  if (phase === "finishing") return 85;
  if (phase === "producing") return 55;
  if (phase === "preparing") return 22;
  return 12;
}

export { classifyTaskFailure, sanitizeTaskError };
export {
  appearanceDescription,
  looksFromBible,
  preferredFaceId,
  stillAssetIds,
  stillKindLabel,
  stillRefEntries,
  STILL_KIND_ORDER,
  wardrobeForScene,
} from "./pipeline/wardrobe.ts";
