import {
  CANDIDATE_KEEP,
  FAILED_ASSET_TTL_DAYS,
  INTERMEDIATE_ASSET_TTL_DAYS,
  SOFT_DELETE_PURGE_DAYS,
} from "../config/models.ts";
import type { Asset, GenerationJob, Series } from "../domain.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionAction = {
  asset_id: string;
  reason:
    | "failed_generation"
    | "intermediate_expired"
    | "excess_candidate"
    | "soft_deleted_series";
};

export function planRetention(input: {
  now: Date;
  series: readonly Series[];
  assets: readonly Asset[];
  jobs: readonly GenerationJob[];
  selectedAssetIds: ReadonlySet<string>;
}): RetentionAction[] {
  const actions: RetentionAction[] = [];
  const nowMs = input.now.getTime();
  const jobById = new Map(input.jobs.map((job) => [job.id, job]));

  const deletedSeries = new Set(
    input.series
      .filter(
        (series) =>
          series.deleted_at &&
          nowMs - Date.parse(series.deleted_at) >=
            SOFT_DELETE_PURGE_DAYS * DAY_MS,
      )
      .map((series) => series.id),
  );

  const candidatesByShot = new Map<string, Asset[]>();

  for (const asset of input.assets) {
    if (asset.deleted_at) continue;

    if (asset.series_id && deletedSeries.has(asset.series_id) && !asset.actor_id) {
      actions.push({ asset_id: asset.id, reason: "soft_deleted_series" });
      continue;
    }

    const jobId = typeof asset.metadata.generation_job_id === "string"
      ? asset.metadata.generation_job_id
      : null;
    const job = jobId ? jobById.get(jobId) : undefined;

    if (job?.status === "failed") {
      if (nowMs - Date.parse(asset.created_at) >= FAILED_ASSET_TTL_DAYS * DAY_MS) {
        actions.push({ asset_id: asset.id, reason: "failed_generation" });
        continue;
      }
    }

    if (
      asset.kind === "shot_video" &&
      !input.selectedAssetIds.has(asset.id)
    ) {
      const shotId = typeof asset.metadata.shot_id === "string"
        ? asset.metadata.shot_id
        : "unknown";
      const list = candidatesByShot.get(shotId) ?? [];
      list.push(asset);
      candidatesByShot.set(shotId, list);
    }

    if (
      (asset.kind === "shot_video" || asset.kind === "dialogue_audio") &&
      !input.selectedAssetIds.has(asset.id) &&
      nowMs - Date.parse(asset.created_at) >=
        INTERMEDIATE_ASSET_TTL_DAYS * DAY_MS
    ) {
      actions.push({ asset_id: asset.id, reason: "intermediate_expired" });
    }
  }

  for (const [, candidates] of candidatesByShot) {
    const sorted = [...candidates].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    for (const extra of sorted.slice(CANDIDATE_KEEP)) {
      if (!actions.some((action) => action.asset_id === extra.id)) {
        actions.push({ asset_id: extra.id, reason: "excess_candidate" });
      }
    }
  }

  return actions;
}
