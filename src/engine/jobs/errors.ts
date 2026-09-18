export type TaskFailureKind = "policy" | "transient" | "quality" | "technical";

const TRANSIENT =
  /fetch failed|network|econnreset|etimedout|enotfound|socket|aborted|429|502|503|504|duplicate key|idempotency|unique constraint|too many requests|temporar/i;

const POLICY = /fictional|not allowed|content.?polic|blocked|moderation|real.person|likeness/i;

const QUALITY =
  /CAST_LOOK|quality bar|qc failed|needs_review|below the quality|not every shot is complete|render failed|mux audit/i;

const INPUT_IMAGE_PRIVACY =
  /InputImageSensitiveContentDetected|PrivacyInformation|input image[\s\S]{0,120}may contain real person/i;

const COPYRIGHT = /copyright|trademark|related to copyright restrictions/i;

export function isCopyrightFailure(message: string): boolean {
  return COPYRIGHT.test(message);
}

export function isInputImagePrivacyFailure(message: string): boolean {
  return INPUT_IMAGE_PRIVACY.test(message);
}

export function classifyTaskFailure(message: string): TaskFailureKind {
  if (isInputImagePrivacyFailure(message)) return "technical";
  if (POLICY.test(message)) return "policy";
  if (QUALITY.test(message)) return "quality";
  if (TRANSIENT.test(message)) return "transient";
  return "technical";
}

export function redactTaskError(message: string | null | undefined): string {
  if (!message) return "runner_failed";
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/bearer\s+\S+/gi, "[redacted]")
    .replace(/\b(sk|rk|whsec|sbp|eyJ)[A-Za-z0-9._-]{8,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function sanitizeTaskError(message: string | null | undefined): string {
  if (!message) return "This step did not finish.";
  if (/duplicate key|idempotency|unique constraint/i.test(message)) {
    return "This step was already finished. Production will continue from the work already done.";
  }
  if (/fetch failed|network|econnreset|etimedout|enotfound|socket|aborted/i.test(message)) {
    return "A studio request dropped. We are retrying this step.";
  }
  if (/429|too many requests/i.test(message)) {
    return "The studio is busy. We will retry in a moment.";
  }
  if (isInputImagePrivacyFailure(message)) {
    return "A reference frame was rejected. We are retrying this step.";
  }
  const openRouter = message.match(/OpenRouter\s+(\S+)\s+failed HTTP (\d+)/i);
  if (openRouter) {
    return `The image studio returned HTTP ${openRouter[2]} on ${openRouter[1]}.`;
  }
  if (/HTTP 5\d\d/i.test(message)) {
    return "The studio had a temporary outage. We are retrying.";
  }
  if (POLICY.test(message)) {
    return "One scene includes content we cannot generate. Edit it and production continues.";
  }
  const cleaned = message
    .replace(/https?:\/\/\S+/g, "")
    .replace(/bearer\s+\S+/gi, "")
    .replace(/\b(sk|rk|whsec|sbp|eyJ)[A-Za-z0-9._-]{8,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return cleaned || "This step hit a production error. We will retry it.";
}

export function failureDecision(kind: TaskFailureKind): { intervention_type: string; agent_decision: string } {
  if (kind === "policy") {
    return {
      intervention_type: "content_policy",
      agent_decision: "One scene includes content we cannot generate. Edit it and production continues.",
    };
  }
  if (kind === "quality") {
    return {
      intervention_type: "quality_budget",
      agent_decision: "This take came in below your quality bar. Use the best take, or we can reshoot.",
    };
  }
  return {
    intervention_type: "technical",
    agent_decision: "Production paused on a studio error. We can retry this step.",
  };
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(60, 2 ** Math.max(1, attempt));
}
