import {
  ACTIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  type GenerationJob,
  type JobStatus,
} from "../domain.ts";

const ALLOWED: Record<JobStatus, ReadonlySet<JobStatus>> = {
  queued: new Set(["submitting", "failed", "cancelled"]),
  submitting: new Set(["generating", "failed", "cancelled"]),
  generating: new Set(["ingesting", "failed", "cancelled"]),
  ingesting: new Set(["qc", "failed", "cancelled"]),
  qc: new Set(["completed", "needs_review", "failed", "cancelled"]),
  completed: new Set(),
  needs_review: new Set(),
  failed: new Set(["queued"]),
  cancelled: new Set(),
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].has(to);
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

export function isActive(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.has(status);
}

export class IllegalJobTransitionError extends Error {
  readonly from: JobStatus;
  readonly to: JobStatus;

  constructor(from: JobStatus, to: JobStatus) {
    super(`Illegal job transition: ${from} → ${to}`);
    this.name = "IllegalJobTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transitionJob(
  job: GenerationJob,
  to: JobStatus,
  updatedAt: string,
  patch: Partial<Omit<GenerationJob, "id" | "status" | "updated_at">> = {},
): GenerationJob {
  if (!canTransition(job.status, to)) {
    throw new IllegalJobTransitionError(job.status, to);
  }

  return {
    ...job,
    ...patch,
    status: to,
    updated_at: updatedAt,
  };
}
