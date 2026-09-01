export const BUSY_VIDEO_STATUSES = ["queued", "submitting", "generating", "ingesting"] as const;

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
      (BUSY_VIDEO_STATUSES as readonly string[]).includes(job.status),
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
