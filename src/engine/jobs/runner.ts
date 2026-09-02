import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAiGateway } from "../ai/index.ts";
import { transcribeAudio } from "../ai/stt.ts";
import { accessFromAppMetadata } from "../access.ts";
import { createEngine } from "../create-engine.ts";
import { classifyTaskFailure, failureDecision, redactTaskError, retryDelaySeconds, sanitizeTaskError } from "./errors.ts";
import { createConfiguredAssetStore } from "../storage/create.ts";
import type { AssetStore } from "../storage/types.ts";
import { configuredRender } from "../media/remote-render.ts";
import { publicLog } from "../logging.ts";
import { voiceSexRepair } from "../ai/voice-sex.ts";
import { BUSY_VIDEO_STATUSES, shotNeedsVideo } from "./queue-policy.ts";
import { commitSeriesStore, isMissingFunction, loadSeriesStore } from "../store-postgres.ts";

/** Takes kept in flight per series; the provider renders them concurrently. */
export const VIDEO_CONCURRENCY = Math.min(12, Math.max(1, Number(process.env.VIDEO_CONCURRENCY ?? 3) || 3));
/** Generated attempts per shot before the production stops for a human. */
export const VIDEO_RETRY_CAP = 3;

export type EngineAction =
  | "analyze"
  | "generate_appearance"
  | "generate_actor"
  | "generate_wardrobe"
  | "design_voice"
  | "lock_character"
  | "lock_locations"
  | "generate_cover"
  | "create_episode"
  | "plan_episode"
  | "generate_dialogue"
  | "generate_video"
  | "regenerate_shot"
  | "review_take"
  | "revise_line"
  | "rejudge_shot"
  | "render_episode"
  | "advance_production"
  | "tick"
  | "reconcile";

type TaskRow = {
  id: string;
  owner_id: string;
  series_id: string;
  production_id?: string | null;
  action: EngineAction;
  payload: Record<string, unknown>;
  status: string;
  attempt: number;
};

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the job runner");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function isAdmin(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  return accessFromAppMetadata(data.user.app_metadata as Record<string, unknown>).isAdmin;
}

/** Lease granted by the claim RPC and renewed by the heartbeat. */
export const TASK_LEASE_SECONDS = 5 * 60;
export const TASK_HEARTBEAT_MS = 60_000;
/** Attempts before a task is dead-lettered instead of re-queued. */
export const TASK_MAX_ATTEMPTS = 6;

let warnedLegacyClaim = false;

/**
 * What this runner is allowed to do. Ingest and render need ffmpeg; the
 * Cloudflare cron has none, so it runs as `orchestrator` and leaves media work
 * (render_episode, and the sweep that ingests finished takes) to a `media` or
 * `all` runner on a host with ffmpeg.
 */
export type RunnerRole = "all" | "orchestrator" | "media";

export function runnerRole(env: NodeJS.ProcessEnv = process.env): RunnerRole {
  const raw = env.RUNNER_ROLE?.trim();
  return raw === "orchestrator" || raw === "media" ? raw : "all";
}

/** Need ffmpeg: CU crops and plate takes at submit, measurement at ingest, the cut. */
const MEDIA_ACTIONS: EngineAction[] = ["generate_video", "regenerate_shot", "rejudge_shot", "render_episode", "tick", "reconcile"];
const ORCHESTRATION_ACTIONS: EngineAction[] = [
  "analyze",
  "generate_appearance",
  "generate_actor",
  "generate_wardrobe",
  "design_voice",
  "lock_character",
  "lock_locations",
  "generate_cover",
  "create_episode",
  "plan_episode",
  "generate_dialogue",
  "review_take",
  "advance_production",
];

export function excludedActionsFor(role: RunnerRole): EngineAction[] | null {
  if (role === "orchestrator") return MEDIA_ACTIONS;
  if (role === "media") return ORCHESTRATION_ACTIONS;
  return null;
}

async function claimTasks(client: SupabaseClient, limit: number, role: RunnerRole = runnerRole()): Promise<TaskRow[]> {
  // FOR UPDATE SKIP LOCKED in the database, one task per series, and only the
  // actions this role can perform: two runners never claim the same row and
  // never work the same series at once.
  const { data, error } = await client.rpc("claim_engine_tasks", { p_limit: limit, p_exclude_actions: excludedActionsFor(role) });
  if (!error) return (data ?? []) as TaskRow[];
  if (!isMissingFunction(error.message)) throw new Error(error.message);
  if (!warnedLegacyClaim) {
    warnedLegacyClaim = true;
    console.warn(JSON.stringify(publicLog({ event: "engine_claim_legacy", reason: "claim_engine_tasks RPC missing; apply the runner_hardening migration" })));
  }
  const excluded = new Set(excludedActionsFor(role) ?? []);
  return (await claimTasksLegacy(client, limit)).filter((task) => !excluded.has(task.action));
}

/** Select-then-update; racy under concurrency. Only used until the claim RPC exists. */
async function claimTasksLegacy(client: SupabaseClient, limit: number): Promise<TaskRow[]> {
  const { data: due, error: dueError } = await client
    .from("engine_tasks")
    .select("*")
    .or("status.eq.queued,and(status.eq.running,lease_until.lt.now())")
    .lte("visible_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (dueError) throw new Error(dueError.message);

  const claimed: TaskRow[] = [];
  for (const row of due ?? []) {
    const { data: updated, error: updateError } = await client
      .from("engine_tasks")
      .update({
        status: "running",
        attempt: (row.attempt ?? 0) + 1,
        lease_until: new Date(Date.now() + TASK_LEASE_SECONDS * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .in("status", ["queued", "running"])
      .select()
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) claimed.push(updated as TaskRow);
  }
  return claimed;
}

/** Renews the lease while a task runs; returns a stop function. */
function startHeartbeat(client: SupabaseClient, task: TaskRow): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        const { data, error } = await client.rpc("extend_engine_task_lease", { p_task_id: task.id, p_seconds: TASK_LEASE_SECONDS });
        if (error && !isMissingFunction(error.message)) {
          console.warn(JSON.stringify(publicLog({ event: "engine_heartbeat_failed", task_id: task.id, error: redactTaskError(error.message) })));
        } else if (data === false) {
          // Someone else owns the row now (lease expired and was reclaimed).
          console.warn(JSON.stringify(publicLog({ event: "engine_lease_lost", task_id: task.id, action: task.action })));
        }
      } catch {
        /* heartbeat is best-effort */
      }
    })();
  }, TASK_HEARTBEAT_MS);
  return () => clearInterval(timer);
}

type JobEvent = {
  kind: string;
  status?: string | null;
  detail?: Record<string, unknown>;
  generation_job_id?: string | null;
};

/** Best-effort operator trail; never fails the task. */
async function recordEvent(client: SupabaseClient, task: TaskRow, event: JobEvent): Promise<void> {
  try {
    await client.from("job_events").insert({
      owner_id: task.owner_id,
      series_id: task.series_id,
      production_id: task.production_id ?? null,
      task_id: task.id,
      generation_job_id: event.generation_job_id ?? null,
      kind: event.kind,
      status: event.status ?? null,
      detail: { action: task.action, attempt: task.attempt, ...(event.detail ?? {}) },
    });
  } catch {
    /* table missing or transient; the task outcome is still on engine_tasks */
  }
}

async function dispatch(task: TaskRow, client: SupabaseClient): Promise<unknown> {
  const { store, assets: assetRows } = await loadSeriesStore(client, task.series_id);
  const assets = createConfiguredAssetStore();
  hydrateAssetStore(assets, assetRows);
  const skipSeriesBudget = await isAdmin(client, task.owner_id);
  const engine = createEngine({
    store,
    assets,
    skipSeriesBudget,
    ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    render: configuredRender(),
  });
  const payload = task.payload;
  const owner_id = task.owner_id;

  if (task.action === "generate_cover") {
    const { count } = await client
      .from("engine_tasks")
      .select("id", { count: "exact", head: true })
      .eq("series_id", task.series_id)
      .eq("action", "generate_cover")
      .eq("status", "failed");
    if ((count ?? 0) >= 3) {
      return { skipped: true, reason: "cover_abandoned" };
    }
  }

  let result: unknown;
  try {
    result = await runAction();
  } catch (error) {
    // A refused render or a dropped take is state the engine recorded (audit
    // asset, needs_review, ledger release). Persist it before surfacing the error.
    if (task.action !== "advance_production") {
      const snapshot = "snapshot" in assets && typeof assets.snapshot === "function" ? assets.snapshot() : assetRows;
      await commitSeriesStore(client, engine.store, task.series_id, snapshot).catch(() => undefined);
    }
    throw error;
  }

  if (task.action !== "advance_production") {
    const snapshot =
      "snapshot" in assets && typeof assets.snapshot === "function" ? assets.snapshot() : assetRows;
    await commitSeriesStore(client, engine.store, task.series_id, snapshot);
  }
  return result;

  async function runAction(): Promise<unknown> {
  let result: unknown;
  switch (task.action) {
    case "analyze":
      result = await engine.analyze({ owner_id, series_id: task.series_id });
      break;
    case "generate_appearance":
      result = await engine.generateAppearance({
        owner_id,
        character_id: String(payload.character_id),
      });
      break;
    case "generate_actor":
      result = await engine.generateActor({
        owner_id,
        actor_id: String(payload.actor_id),
        series_id: task.series_id,
        seed_bytes:
          typeof payload.seed_base64 === "string" && payload.seed_base64
            ? Uint8Array.from(Buffer.from(payload.seed_base64, "base64"))
            : undefined,
        seed_mime_type: payload.seed_mime_type ? String(payload.seed_mime_type) : undefined,
      });
      break;
    case "generate_wardrobe":
      result = await engine.generateWardrobe({
        owner_id,
        character_id: String(payload.character_id),
      });
      break;
    case "design_voice":
      result = await engine.designVoice({
        owner_id,
        character_id: String(payload.character_id),
      });
      break;
    case "lock_character":
      result = await engine.lockCharacter({
        owner_id,
        character_id: String(payload.character_id),
        voice_candidate_id: payload.voice_candidate_id
          ? String(payload.voice_candidate_id)
          : undefined,
      });
      break;
    case "lock_locations":
      result = await engine.lockLocations({ owner_id, series_id: task.series_id });
      break;
    case "generate_cover":
      result = await engine.generateSeriesCover({ owner_id, series_id: task.series_id });
      break;
    case "create_episode":
      result = await engine.createEpisode({
        owner_id,
        series_id: task.series_id,
        episode_number: Number(payload.episode_number),
        title: String(payload.title ?? `Episode ${payload.episode_number}`),
      });
      break;
    case "plan_episode":
      result = await engine.planEpisode({
        owner_id,
        episode_id: String(payload.episode_id),
        episode_length:
          payload.episode_length === "30_45" ||
          payload.episode_length === "60_90" ||
          payload.episode_length === "120_180" ||
          payload.episode_length === "900_1080"
            ? payload.episode_length
            : undefined,
      });
      break;
    case "generate_dialogue":
      result = await engine.generateDialogue({ owner_id, shot_id: String(payload.shot_id) });
      break;
    case "generate_video":
      result = await engine.generateVideo({ owner_id, shot_id: String(payload.shot_id) });
      break;
    case "regenerate_shot":
      result = await engine.regenerateShot({ owner_id, shot_id: String(payload.shot_id) });
      break;
    case "rejudge_shot":
      result = await engine.rejudgeShot({ owner_id, shot_id: String(payload.shot_id) });
      break;
    case "revise_line":
      result = await engine.reviseLine({ owner_id, shot_id: String(payload.shot_id), dialogue: String(payload.dialogue ?? "") });
      break;
    case "review_take":
      result = await engine.reviewTake({
        owner_id,
        shot_id: String(payload.shot_id),
        asset_id: String(payload.asset_id),
        decision: payload.decision === "reject" ? "reject" : "approve",
        note: typeof payload.note === "string" ? payload.note : null,
      });
      break;
    case "render_episode": {
      const deliverables: Array<"1:1" | "16:9"> = Array.isArray(payload.deliverables)
        ? payload.deliverables.filter((row): row is "1:1" | "16:9" => row === "1:1" || row === "16:9")
        : ["1:1", "16:9"];
      result = await engine.renderEpisode({ owner_id, episode_id: String(payload.episode_id), deliverables });
      break;
    }
    case "advance_production":
      result = await advanceProduction(client, task);
      break;
    case "tick":
      await engine.tick();
      result = { ok: true };
      break;
    case "reconcile":
      result = await engine.reconcile();
      break;
    default:
      throw new Error(`Unknown engine action ${task.action}`);
  }
  return result;
  }
}

async function sweepActiveJobs(client: SupabaseClient): Promise<void> {
  const { data, error } = await client
    .from("generation_jobs")
    .select("series_id")
    .in("status", ["queued", "submitting", "generating", "ingesting"]);
  if (error) throw new Error(error.message);
  const seriesIds = [...new Set((data ?? []).map((row) => row.series_id).filter(Boolean))];
  for (const seriesId of seriesIds) {
    const { store, assets: assetRows } = await loadSeriesStore(client, seriesId);
    const assets = createConfiguredAssetStore();
    hydrateAssetStore(assets, assetRows);
    const engine = createEngine({
      store,
      assets,
      ai: createAiGateway({ stt: { transcribe: transcribeAudio } }),
    });
    try {
      await engine.tick();
      await engine.reconcile();
      const snapshot =
        "snapshot" in assets && typeof assets.snapshot === "function" ? assets.snapshot() : assetRows;
      await commitSeriesStore(client, engine.store, seriesId, snapshot);
      await queueAdvanceForSeries(client, seriesId);
    } catch (error) {
      console.warn(
        JSON.stringify(
          publicLog({
            event: "sweep_active_jobs_failed",
            series_id: seriesId,
            error: redactTaskError(error instanceof Error ? error.message : "sweep_failed"),
          }),
        ),
      );
    }
  }
}

function hydrateAssetStore(assets: AssetStore, rows: readonly unknown[]) {
  const hydratable = assets as AssetStore & { hydrate?: (rows: readonly unknown[]) => void };
  if (typeof hydratable.hydrate === "function") hydratable.hydrate(rows);
}

/** Small, safe summary of a dispatch result for the event trail. */
function taskResultSummary(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const row = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const job = row.job as Record<string, unknown> | undefined;
  if (job && typeof job.id === "string") {
    out.generation_job_id = job.id;
    out.job_status = job.status;
    if (typeof job.model === "string") out.model = job.model;
    if (typeof job.actual_cost === "number") out.actual_cost = job.actual_cost;
  }
  if (Array.isArray(row.queued)) out.queued = row.queued;
  if (typeof row.complete === "boolean") out.complete = row.complete;
  if (typeof row.checksum === "string") out.checksum = row.checksum;
  if (typeof row.skipped === "boolean") out.skipped = row.skipped;
  return out;
}

function logTaskFailure(task: TaskRow, message: string) {
  console.warn(
    JSON.stringify(
      publicLog({
        event: "engine_task_failed",
        action: task.action,
        series_id: task.series_id,
        character_id: task.payload.character_id,
        attempt: task.attempt,
        error: redactTaskError(message),
      }),
    ),
  );
}

async function writeTaskOutcome(
  client: SupabaseClient,
  task: TaskRow,
  input: {
    status: string;
    message?: string | null;
    visible_at?: string;
  },
) {
  const publicMessage = input.message != null && input.message !== "" ? sanitizeTaskError(input.message) : null;
  const internal = input.message != null && input.message !== "" ? redactTaskError(input.message) : null;
  const patch: Record<string, unknown> = {
    status: input.status,
    error_code: publicMessage,
    error_detail: internal,
    payload: { ...task.payload, ...(internal ? { error_detail: internal } : {}) },
    lease_until: null,
    ...(input.visible_at ? { visible_at: input.visible_at } : {}),
    updated_at: new Date().toISOString(),
  };
  const first = await client.from("engine_tasks").update(patch).eq("id", task.id);
  if (!first.error) return;
  if (!/error_detail/i.test(first.error.message)) throw new Error(first.error.message);
  delete patch.error_detail;
  const retry = await client.from("engine_tasks").update(patch).eq("id", task.id);
  if (retry.error) throw new Error(retry.error.message);
}

async function recoverTechnicalStops(client: SupabaseClient): Promise<void> {
  const { data, error } = await client
    .from("productions")
    .select("id, owner_id, series_id, updated_at")
    .eq("status", "needs_user")
    .eq("intervention_type", "technical")
    .eq("paused", false)
    .lt("updated_at", new Date(Date.now() - 20_000).toISOString())
    .limit(5);
  if (error || !data?.length) return;
  for (const row of data) {
    const { data: failed } = await client
      .from("engine_tasks")
      .select("attempt, action")
      .eq("production_id", row.id)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (failed?.action === "generate_cover") continue;
    if (failed?.action === "lock_character" && (failed.attempt ?? 0) >= 6) continue;
    if (failed?.action === "lock_locations" && (failed.attempt ?? 0) >= 6) continue;
    if ((failed?.attempt ?? 0) >= 8) continue;
    await client
      .from("productions")
      .update({
        status: "queued",
        ui_phase: "preparing",
        intervention_type: null,
        intervention: {},
        agent_decision: "Retrying the last studio error automatically.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    await queueTask(client, {
      owner_id: row.owner_id,
      series_id: row.series_id,
      production_id: row.id,
      action: "advance_production",
    });
  }
}

export async function runOnce(client = serviceClient(), limit = VIDEO_CONCURRENCY): Promise<number> {
  await recoverTechnicalStops(client);
  const tasks = await claimTasks(client, limit);
  let completed = 0;
  const videoSlots = { active: 0 };
  // Each task loads and commits the whole series snapshot, so tasks on the same
  // series must run one after another; different series run in parallel.
  const bySeries = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const list = bySeries.get(task.series_id) ?? [];
    list.push(task);
    bySeries.set(task.series_id, list);
  }
  await Promise.all(
    [...bySeries.values()].map(async (seriesTasks) => {
      for (const task of seriesTasks) await runTask(task);
    }),
  );

  async function runTask(task: TaskRow): Promise<void> {
    {
      const isVideo = task.action === "generate_video" || task.action === "regenerate_shot";
      if (isVideo) {
        while (videoSlots.active >= VIDEO_CONCURRENCY) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        videoSlots.active += 1;
      }
      const stopHeartbeat = startHeartbeat(client, task);
      const startedAt = Date.now();
      try {
        const result = await dispatch(task, client);
        await writeTaskOutcome(client, task, { status: "done" });
        await recordEvent(client, task, {
          kind: "task_done",
          status: "done",
          detail: { duration_ms: Date.now() - startedAt, ...taskResultSummary(result) },
        });
        if (task.action !== "advance_production") {
          if (task.production_id) {
            await client
              .from("productions")
              .update({
                status: "running",
                paused: false,
                intervention_type: null,
                intervention: {},
                ui_phase: isVideo ? "producing" : "preparing",
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.production_id)
              .in("status", ["needs_user", "queued", "running"]);
          }
          await queueAdvanceForSeries(client, task.series_id);
        }
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "runner_failed";
        const kind = classifyTaskFailure(message);
        const attempt = task.attempt ?? 1;
        logTaskFailure(task, message);
        if (task.action === "generate_cover") {
          await writeTaskOutcome(client, task, { status: "failed", message });
          await recordEvent(client, task, { kind: "task_failed", status: "failed", detail: { failure_kind: kind, error: redactTaskError(message) } });
          if (task.production_id) {
            await markProduction(
              client,
              task.production_id,
              "running",
              "preparing",
              `Cover art can wait. ${sanitizeTaskError(message)} Production continues.`,
            );
            await queueAdvanceForSeries(client, task.series_id);
          }
        } else if ((kind === "transient" || kind === "technical") && attempt < TASK_MAX_ATTEMPTS) {
          const delay = retryDelaySeconds(attempt);
          await writeTaskOutcome(client, task, {
            status: "queued",
            message,
            visible_at: new Date(Date.now() + delay * 1000).toISOString(),
          });
          await recordEvent(client, task, {
            kind: "task_retry",
            status: "queued",
            detail: { failure_kind: kind, retry_in_seconds: delay, error: redactTaskError(message) },
          });
          if (task.production_id) {
            await markProduction(
              client,
              task.production_id,
              "running",
              "preparing",
              `Retrying automatically. ${sanitizeTaskError(message)}`,
            );
          }
        } else {
          const decision = failureDecision(kind);
          // Retries exhausted (or the failure is not retryable): dead-letter the
          // task so operators can tell it from a task that will run again.
          const exhausted = (kind === "transient" || kind === "technical") && attempt >= TASK_MAX_ATTEMPTS;
          const status = exhausted ? "dead_lettered" : "failed";
          await writeTaskOutcome(client, task, { status, message });
          await recordEvent(client, task, {
            kind: exhausted ? "task_dead_lettered" : "task_failed",
            status,
            detail: { failure_kind: kind, error: redactTaskError(message) },
          });
          if (task.production_id) {
            await client
              .from("productions")
              .update({
                status: "needs_user",
                ui_phase: "needs_you",
                intervention_type: decision.intervention_type,
                intervention: { kind, message: sanitizeTaskError(message), dead_lettered: exhausted },
                agent_decision: decision.agent_decision,
                updated_at: new Date().toISOString(),
              })
              .eq("id", task.production_id);
          }
        }
      } finally {
        stopHeartbeat();
        if (isVideo) videoSlots.active -= 1;
      }
    }
  }
  // The sweep ingests finished takes, which measures them with ffmpeg; an
  // orchestrator has none and leaves that to the media runner.
  if (runnerRole() !== "orchestrator") await sweepActiveJobs(client);
  return completed;
}

async function queueTask(
  client: SupabaseClient,
  input: {
    owner_id: string;
    series_id: string;
    production_id?: string | null;
    action: EngineAction;
    payload?: Record<string, unknown>;
  },
) {
  const { data: existing } = await client
    .from("engine_tasks")
    .select("id, payload")
    .eq("series_id", input.series_id)
    .eq("action", input.action)
    .in("status", ["queued", "running"]);
  const fingerprint = JSON.stringify(input.payload ?? {});
  if ((existing ?? []).some((row) => JSON.stringify(row.payload ?? {}) === fingerprint)) return;
  await client.from("engine_tasks").insert({
    owner_id: input.owner_id,
    series_id: input.series_id,
    production_id: input.production_id ?? null,
    action: input.action,
    payload: input.payload ?? {},
    status: "queued",
  });
}

async function queueAdvanceForSeries(client: SupabaseClient, seriesId: string) {
  const { data } = await client
    .from("productions")
    .select("id, owner_id, series_id, paused, status")
    .eq("series_id", seriesId)
    .in("status", ["queued", "running"])
    .eq("paused", false);
  for (const production of data ?? []) {
    await queueTask(client, {
      owner_id: production.owner_id,
      series_id: production.series_id,
      production_id: production.id,
      action: "advance_production",
      payload: { production_id: production.id },
    });
  }
}

async function advanceProduction(client: SupabaseClient, task: TaskRow): Promise<unknown> {
  const productionId = String(task.payload.production_id ?? task.production_id ?? "");
  if (!productionId) throw new Error("production_id is required");
  const { data: production, error } = await client
    .from("productions")
    .select("*")
    .eq("id", productionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!production || production.paused || production.status === "awaiting_payment") {
    return { skipped: true };
  }

  const { data: series } = await client.from("series").select("*").eq("id", production.series_id).single();
  const { data: characters } = await client.from("characters").select("*").eq("series_id", production.series_id);
  const { data: episodes } = await client
    .from("episodes")
    .select("*")
    .eq("series_id", production.series_id)
    .gte("episode_number", production.episode_start)
    .lte("episode_number", production.episode_end)
    .order("episode_number");

  const owner_id = production.owner_id;
  const series_id = production.series_id;
  const queued: string[] = [];
  await restoreStillRefs(client, series_id, characters ?? []);
  await restoreVoicePreviews(client, series_id, characters ?? []);

  if (!series?.story_bible) {
    queued.push("analyze");
    await queueTask(client, { owner_id, series_id, production_id: productionId, action: "analyze" });
    await markProduction(client, productionId, "running", "preparing", "Writing the story bible and locking the fictional cast.");
    return { queued };
  }

  for (const character of characters ?? []) {
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(voice.pending_previews) ? voice.pending_previews : [];
    const repair = voiceSexRepair({
      locked: Boolean(character.locked),
      design_prompt: String(voice.design_prompt ?? ""),
      identityText: `${character.name}. ${character.description}`,
    });
    if (repair.action === "none") continue;
    const nextVoice: Record<string, unknown> = {
      ...voice,
      design_prompt: repair.design_prompt,
      pending_previews: pending,
    };
    if (repair.action === "unlock_wrong_sex") {
      nextVoice.elevenlabs_voice_id = null;
      nextVoice.locked = false;
      character.locked = false;
    }
    character.voice_profile = nextVoice;
    await client
      .from("characters")
      .update({
        locked: character.locked,
        voice_profile: nextVoice,
        updated_at: new Date().toISOString(),
      })
      .eq("id", character.id);
  }

  const { data: voiceRefRows } = await client
    .from("assets")
    .select("id, metadata")
    .eq("series_id", series_id)
    .eq("kind", "voice_reference")
    .is("deleted_at", null);
  const voiceRefByCharacter = new Map<string, string>();
  for (const asset of voiceRefRows ?? []) {
    const meta = (asset.metadata ?? {}) as Record<string, unknown>;
    const characterId = String(meta.character_id ?? "");
    const voiceId = meta.elevenlabs_voice_id;
    if (characterId && typeof voiceId === "string" && voiceId && !voiceRefByCharacter.has(characterId)) {
      voiceRefByCharacter.set(characterId, voiceId);
    }
  }

  const unlocked = (characters ?? []).filter((character) => !character.locked);
  if ((characters ?? []).length === 0) {
    queued.push("analyze");
    await queueTask(client, { owner_id, series_id, production_id: productionId, action: "analyze" });
    return { queued };
  }

  for (const character of unlocked) {
    const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
    const refs = (visual.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
    const hasRefs = Boolean(refs.front) || Object.keys(refs).length > 0;
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(voice.pending_previews) ? voice.pending_previews : [];
    const hasVoice = Boolean(voice.elevenlabs_voice_id) || voiceRefByCharacter.has(String(character.id));
    const hasPendingVoice = pending.length > 0;
    const wardrobe = (visual.wardrobe_asset_ids ?? {}) as Record<string, unknown>;
    const hasWardrobe = Object.keys(wardrobe).length > 0;
    if (!hasRefs) {
      queued.push("generate_appearance");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "generate_appearance",
        payload: { character_id: character.id },
      });
      continue;
    }
    if (!hasWardrobe) {
      queued.push("generate_wardrobe");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "generate_wardrobe",
        payload: { character_id: character.id },
      });
      continue;
    }
    const { data: voiceJob } = !hasVoice && !hasPendingVoice
      ? await client
          .from("generation_jobs")
          .select("id")
          .eq("series_id", series_id)
          .eq("job_type", "voice_design")
          .eq("status", "completed")
          .contains("request_metadata", { character_id: character.id })
          .limit(1)
          .maybeSingle()
      : { data: null };
    const canLock = hasVoice || hasPendingVoice || Boolean(voiceJob);
    if (!canLock) {
      queued.push("design_voice");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "design_voice",
        payload: { character_id: character.id },
      });
      continue;
    }
    queued.push("lock_character");
    await queueTask(client, {
      owner_id,
      series_id,
      production_id: productionId,
      action: "lock_character",
      payload: { character_id: character.id },
    });
  }

  if (queued.length) {
    await markProduction(client, productionId, "running", "preparing", "Creating the locked cast. Face and voice will stay the same across every episode.");
  }

  if (unlocked.length > 0) {
    return { queued };
  }

  const hasStill = (characters ?? []).some((character) => {
    const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
    const refs = (visual.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
    return Boolean(refs.front) || Object.keys(refs).length > 0;
  });
  if (!series?.cover_asset_id && hasStill) {
    const { data: coverTasks } = await client
      .from("engine_tasks")
      .select("id, status")
      .eq("series_id", series_id)
      .eq("action", "generate_cover")
      .in("status", ["queued", "running", "failed"]);
    const inflight = (coverTasks ?? []).some((row) => row.status === "queued" || row.status === "running");
    const failedCount = (coverTasks ?? []).filter((row) => row.status === "failed").length;
    if (failedCount >= 1) {
      await client
        .from("engine_tasks")
        .update({
          status: "done",
          error_code: "Cover art can wait. Production continues.",
          updated_at: new Date().toISOString(),
        })
        .eq("series_id", series_id)
        .eq("action", "generate_cover")
        .in("status", ["queued", "running"]);
    } else if (!inflight) {
      queued.push("generate_cover");
      await queueTask(client, { owner_id, series_id, production_id: productionId, action: "generate_cover" });
    }
  }

  const locationRefs = (series.location_refs ?? {}) as Record<string, unknown>;
  if (Object.keys(locationRefs).length === 0) {
    queued.push("lock_locations");
    await queueTask(client, { owner_id, series_id, production_id: productionId, action: "lock_locations" });
    await markProduction(client, productionId, "running", "preparing", "Locking recurring locations.");
    return { queued };
  }

  const wanted = [] as number[];
  for (let n = production.episode_start; n <= production.episode_end; n += 1) wanted.push(n);
  const byNumber = new Map((episodes ?? []).map((episode) => [episode.episode_number, episode]));
  if (task.payload.use_best) {
    await promoteReviewTakes(client, series_id);
  } else {
    await backfillShotTakes(client, series_id);
  }
  let waitingOnVideo = false;

  for (const number of wanted) {
    const episode = byNumber.get(number);
    if (!episode) {
      queued.push("create_episode");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "create_episode",
        payload: { episode_number: number, title: `Episode ${number}` },
      });
      continue;
    }
    if (episode.status === "draft") {
      queued.push("plan_episode");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "plan_episode",
        payload: { episode_id: episode.id, episode_length: production.episode_length },
      });
      continue;
    }
    if (episode.status === "complete") continue;

    const { data: scenes } = await client.from("scenes").select("id").eq("episode_id", episode.id);
    const sceneIds = (scenes ?? []).map((row) => row.id);
    const { data: shots } = sceneIds.length
      ? await client.from("shots").select("*").in("scene_id", sceneIds)
      : { data: [] };
    const missingAudio = (shots ?? []).filter((shot) => {
      const data = (shot.shot_data ?? {}) as Record<string, unknown>;
      return Boolean(data.dialogue) && !data.dialogue_audio_asset_id;
    });
    const { data: videoJobs } = await client
      .from("generation_jobs")
      .select("shot_id, job_type, status, model, created_at")
      .eq("series_id", series_id)
      .eq("job_type", "video");
    const playable = await playableTakesByShot(client, series_id);
    const unfinishedVideo = (shots ?? []).filter((shot) => !playable.has(shot.id));
    // A shot with no clean take after RETRY_CAP generated attempts stops the
    // production for a human instead of buying a fourth, fifth, sixth take.
    // Attempts made before the reviewer's latest decision on the shot do not
    // count: a rejection is an instruction to shoot again.
    const reviewedAt = new Map<string, number>();
    for (const shot of shots ?? []) {
      const data = (shot.shot_data ?? {}) as Record<string, unknown>;
      // A rewritten line resets the budget the same way a reviewer decision does.
      const revised = typeof data.line_revised_at === "string" ? Date.parse(data.line_revised_at) : NaN;
      if (Number.isFinite(revised)) reviewedAt.set(shot.id, Math.max(reviewedAt.get(shot.id) ?? 0, revised));
      const reviews = data.take_reviews;
      if (!Array.isArray(reviews)) continue;
      for (const review of reviews as Array<{ reviewed_at?: string }>) {
        const at = review.reviewed_at ? Date.parse(review.reviewed_at) : NaN;
        if (Number.isFinite(at)) reviewedAt.set(shot.id, Math.max(reviewedAt.get(shot.id) ?? 0, at));
      }
    }
    const attemptsByShot = new Map<string, number>();
    for (const job of videoJobs ?? []) {
      if (!job.shot_id || job.model === "plate/zoompan") continue;
      if (Date.parse(job.created_at) <= (reviewedAt.get(job.shot_id) ?? 0)) continue;
      if (["completed", "needs_review", "failed", "cancelled"].includes(job.status)) {
        attemptsByShot.set(job.shot_id, (attemptsByShot.get(job.shot_id) ?? 0) + 1);
      }
    }
    const exhausted = unfinishedVideo.filter((shot) => {
      const data = (shot.shot_data ?? {}) as Record<string, unknown>;
      const isWide = data.function === "establishing" || data.type === "establishing";
      return !isWide && (attemptsByShot.get(shot.id) ?? 0) >= VIDEO_RETRY_CAP;
    });
    if (exhausted.length) {
      await client
        .from("productions")
        .update({
          status: "needs_user",
          ui_phase: "needs_you",
          intervention_type: "quality_budget",
          intervention: {
            kind: "quality",
            message: `${exhausted.length} shot(s) did not produce a clean take in ${VIDEO_RETRY_CAP} attempts.`,
            shot_ids: exhausted.map((shot) => shot.id),
          },
          agent_decision: "Every attempt on these shots was rejected by QC. Review the takes, use the best, or reshoot with a different line.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", productionId);
      return { queued, complete: false, exhausted: exhausted.map((shot) => shot.id) };
    }
    const missingVideo = unfinishedVideo.filter((shot) =>
      shotNeedsVideo(shot, videoJobs ?? [], { hasTake: playable.has(shot.id) }),
    );
    // Submits are quick and the provider renders concurrently, so keep up to
    // VIDEO_CONCURRENCY takes in flight instead of one at a time. Tasks on one
    // series still execute serially in runOnce, so the snapshot commits never race.
    const inFlightVideo = (videoJobs ?? []).filter((job) => BUSY_VIDEO_STATUSES.includes(job.status as (typeof BUSY_VIDEO_STATUSES)[number])).length;
    const videoSlotsOpen = Math.max(0, VIDEO_CONCURRENCY - inFlightVideo);
    if (missingAudio.length) {
      for (const shot of missingAudio.slice(0, VIDEO_CONCURRENCY)) {
        queued.push("generate_dialogue");
        await queueTask(client, {
          owner_id,
          series_id,
          production_id: productionId,
          action: "generate_dialogue",
          payload: { shot_id: shot.id },
        });
      }
    } else if (missingVideo.length && videoSlotsOpen > 0) {
      for (const shot of missingVideo.slice(0, videoSlotsOpen)) {
        queued.push("generate_video");
        await queueTask(client, {
          owner_id,
          series_id,
          production_id: productionId,
          action: "generate_video",
          payload: { shot_id: shot.id },
        });
      }
    } else if (unfinishedVideo.length) {
      waitingOnVideo = true;
    } else if ((shots ?? []).length > 0) {
      queued.push("render_episode");
      await queueTask(client, {
        owner_id,
        series_id,
        production_id: productionId,
        action: "render_episode",
        payload: { episode_id: episode.id },
      });
    }
  }

  const complete = wanted.every((number) => byNumber.get(number)?.status === "complete");
  if (complete) {
    await markProduction(
      client,
      productionId,
      "ready",
      "ready",
      production.sku === "2"
        ? "Pilot is ready. Watch it, then approve the cast before buying the rest of the run."
        : "This run is ready to publish.",
    );
    return { queued, complete: true };
  }

  await markProduction(
    client,
    productionId,
    "running",
    queued.includes("generate_video") || queued.includes("render_episode") || waitingOnVideo
      ? "producing"
      : "preparing",
    queued.includes("render_episode") && !queued.includes("generate_video")
      ? "Cutting the episode."
      : queued.length
        ? "The production is moving. You can close this page."
        : waitingOnVideo
          ? "Shots are still coming in from the studio."
          : "Waiting for the next step.",
  );
  return { queued };
}

async function seriesSceneIds(client: SupabaseClient, seriesId: string): Promise<string[]> {
  const { data: episodes } = await client.from("episodes").select("id").eq("series_id", seriesId);
  const episodeIds = (episodes ?? []).map((row) => row.id);
  if (episodeIds.length === 0) return [];
  const { data: scenes } = await client.from("scenes").select("id").in("episode_id", episodeIds);
  return (scenes ?? []).map((row) => row.id);
}

async function playableTakesByShot(client: SupabaseClient, seriesId: string): Promise<Map<string, string>> {
  const { data: rows } = await client
    .from("assets")
    .select("id, metadata, created_at")
    .eq("series_id", seriesId)
    .eq("kind", "shot_video")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  // Reviewer decisions: a rejected take is never playable; an approved one always is.
  const sceneIds = await seriesSceneIds(client, seriesId);
  const { data: reviewedShots } = sceneIds.length
    ? await client.from("shots").select("id, shot_data").in("scene_id", sceneIds)
    : { data: [] as Array<{ id: string; shot_data: Record<string, unknown> }> };
  const rejected = new Set<string>();
  const approved = new Map<string, string>();
  for (const shot of reviewedShots ?? []) {
    const reviews = ((shot.shot_data ?? {}) as Record<string, unknown>).take_reviews;
    if (!Array.isArray(reviews)) continue;
    for (const review of reviews as Array<{ asset_id?: string; decision?: string }>) {
      if (typeof review.asset_id !== "string") continue;
      if (review.decision === "reject") rejected.add(review.asset_id);
      if (review.decision === "approve") approved.set(shot.id, review.asset_id);
    }
  }
  const takes = new Map<string, string>();
  const live = new Set<string>();
  for (const row of rows ?? []) {
    if (rejected.has(row.id)) continue;
    live.add(row.id);
    const shotId = (row.metadata as Record<string, unknown> | null)?.shot_id;
    if (typeof shotId === "string" && shotId) takes.set(shotId, row.id);
  }
  const { data: jobs } = await client
    .from("generation_jobs")
    .select("shot_id, result_metadata, updated_at")
    .eq("series_id", seriesId)
    .eq("job_type", "video")
    .order("updated_at", { ascending: true });
  // Only a measured, blocker-free take is playable. An unmeasured take (fetched
  // before analysis ran) counts only for shots that have no measured take at
  // all; a shot whose every measured take is blocked has none.
  const measuredClean = new Map<string, string>();
  const unmeasured = new Map<string, string>();
  const measuredBlocked = new Set<string>();
  for (const job of jobs ?? []) {
    const meta = (job.result_metadata as Record<string, unknown> | null) ?? {};
    const assetId = meta.asset_id;
    if (!job.shot_id || typeof assetId !== "string" || !live.has(assetId)) continue;
    if (!Array.isArray(meta.take_blockers)) {
      unmeasured.set(job.shot_id, assetId);
      continue;
    }
    if (meta.take_blockers.length) {
      measuredBlocked.add(job.shot_id);
      continue;
    }
    measuredClean.set(job.shot_id, assetId);
  }
  takes.clear();
  for (const [shotId, assetId] of measuredClean) takes.set(shotId, assetId);
  for (const [shotId, assetId] of unmeasured) {
    if (!measuredClean.has(shotId) && !measuredBlocked.has(shotId)) takes.set(shotId, assetId);
  }
  for (const [shotId, assetId] of approved) {
    if (live.has(assetId)) takes.set(shotId, assetId);
  }
  return takes;
}

async function backfillShotTakes(client: SupabaseClient, seriesId: string): Promise<void> {
  const sceneIds = await seriesSceneIds(client, seriesId);
  if (sceneIds.length === 0) return;
  const takes = await playableTakesByShot(client, seriesId);
  const { data: shots } = await client.from("shots").select("id, selected_generation_id").in("scene_id", sceneIds);
  for (const shot of shots ?? []) {
    const take = takes.get(shot.id);
    if (!take || shot.selected_generation_id === take) continue;
    await client.from("shots").update({ selected_generation_id: take }).eq("id", shot.id);
  }
}

export async function promoteReviewTakes(client: SupabaseClient, seriesId: string): Promise<number> {
  const sceneIds = await seriesSceneIds(client, seriesId);
  if (sceneIds.length === 0) return 0;
  await backfillShotTakes(client, seriesId);
  const playable = await playableTakesByShot(client, seriesId);
  const { data: shots } = await client
    .from("shots")
    .select("id, status, selected_generation_id")
    .in("scene_id", sceneIds)
    .eq("status", "needs_review");
  let promoted = 0;
  for (const shot of shots ?? []) {
    if (!playable.has(shot.id)) continue;
    await client.from("shots").update({ status: "complete" }).eq("id", shot.id);
    promoted += 1;
  }
  return promoted;
}

async function restoreVoicePreviews(
  client: SupabaseClient,
  seriesId: string,
  characters: Array<Record<string, unknown>>,
) {
  const missing = characters.filter((character) => {
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(voice.pending_previews) ? voice.pending_previews : [];
    return !voice.elevenlabs_voice_id && pending.length === 0;
  });
  if (!missing.length) return;
  const { data: jobs } = await client
    .from("generation_jobs")
    .select("result_metadata, request_metadata, created_at")
    .eq("series_id", seriesId)
    .eq("job_type", "voice_design")
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  for (const character of missing) {
    const job = (jobs ?? []).find(
      (row) => String((row.request_metadata as Record<string, unknown> | null)?.character_id ?? "") === character.id,
    );
    const result = (job?.result_metadata ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(result.preview_ids) ? result.preview_ids : [];
    const assetIds = Array.isArray(result.preview_asset_ids) ? result.preview_asset_ids : [];
    const pending = ids
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
    if (!pending.length) continue;
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    character.voice_profile = { ...voice, pending_previews: pending };
    await client
      .from("characters")
      .update({
        voice_profile: character.voice_profile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", character.id);
  }

  const stillMissing = characters.filter((character) => {
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(voice.pending_previews) ? voice.pending_previews : [];
    return !voice.elevenlabs_voice_id && pending.length === 0;
  });
  if (!stillMissing.length) return;
  const { data: previews } = await client
    .from("assets")
    .select("id, mime_type, metadata, created_at")
    .eq("series_id", seriesId)
    .eq("kind", "voice_preview")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  for (const character of stillMissing) {
    const matches = (previews ?? []).filter(
      (asset) => String((asset.metadata as Record<string, unknown> | null)?.character_id ?? "") === character.id,
    );
    if (!matches.length) continue;
    const pending = matches.map((asset, index) => {
      const meta = (asset.metadata ?? {}) as Record<string, unknown>;
      const previewId = String(meta.preview_id ?? asset.id);
      return {
        preview_id: previewId,
        elevenlabs_voice_id: String(meta.elevenlabs_voice_id ?? previewId),
        preview_label: String.fromCharCode(65 + index),
        asset_id: asset.id,
        mime_type: asset.mime_type || "audio/mpeg",
      };
    });
    const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
    character.voice_profile = { ...voice, pending_previews: pending };
    await client
      .from("characters")
      .update({
        voice_profile: character.voice_profile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", character.id);
  }
}

async function restoreStillRefs(
  client: SupabaseClient,
  seriesId: string,
  characters: Array<Record<string, unknown>>,
) {
  const missing = characters.filter((character) => {
    const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
    const refs = (visual.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
    return Object.keys(refs).length === 0;
  });
  if (!missing.length) return;
  const { data: stills } = await client
    .from("assets")
    .select("id, metadata")
    .eq("series_id", seriesId)
    .eq("kind", "character_reference")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  for (const character of missing) {
    const matches = (stills ?? []).filter(
      (asset) => String((asset.metadata as Record<string, unknown> | null)?.character_id ?? "") === character.id,
    );
    if (!matches.length) continue;
    const refs: Record<string, string> = {};
    for (const asset of matches) {
      const kind = String((asset.metadata as Record<string, unknown> | null)?.kind ?? "front");
      if (!refs[kind]) refs[kind] = asset.id;
    }
    if (!refs.front && matches[0]) refs.front = matches[0].id;
    const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
    character.visual_profile = { ...visual, visual_reference_asset_ids: refs };
    await client
      .from("characters")
      .update({
        visual_profile: character.visual_profile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", character.id);
  }
}

async function markProduction(
  client: SupabaseClient,
  id: string,
  status: string,
  uiPhase: string,
  decision: string,
) {
  await client
    .from("productions")
    .update({
      status,
      ui_phase: uiPhase,
      agent_decision: decision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function runLoop(intervalMs = 2000): Promise<void> {
  const client = serviceClient();
  for (;;) {
    await runOnce(client);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
