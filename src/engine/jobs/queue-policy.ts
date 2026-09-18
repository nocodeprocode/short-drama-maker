export const BUSY_VIDEO_STATUSES = ["queued", "submitting", "generating", "ingesting", "qc"] as const;

export function isBusyVideoJob(status: string): boolean {
  return (BUSY_VIDEO_STATUSES as readonly string[]).includes(status);
}

export function productionTaskMayRun(
  production: { status?: string | null; paid_amount?: number | string | null; paused?: boolean | null } | null | undefined,
): boolean {
  return Boolean(
    production &&
      Number(production.paid_amount ?? 0) > 0 &&
      (production.status === "queued" || production.status === "running") &&
      !production.paused,
  );
}

export function shotNeedsVideo(
  shot: { id: string; status: string },
  jobs: ReadonlyArray<{ shot_id?: string | null; job_type: string; status: string }>,
  options: { hasTake?: boolean } = {},
): boolean {
  const hasTake = options.hasTake ?? (shot.status === "complete" || shot.status === "needs_review");
  if (hasTake) return false;
  return !jobs.some(
    (job) =>
      job.job_type === "video" &&
      job.shot_id === shot.id &&
      isBusyVideoJob(job.status),
  );
}

export function queueVisibleAt(job: {
  upstream_job_id: string | null;
  expected_ready_at?: string | null;
  created_at: string;
}): string {
  if (job.upstream_job_id) return job.expected_ready_at ?? job.created_at;
  return job.created_at;
}
