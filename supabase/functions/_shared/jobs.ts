/**
 * Long enough for the jobs Worker to accept the wake, short enough that a cold
 * or wedged Worker never holds a user request open. The Worker drains the queue
 * after it replies, and cron is the fallback if the wake is missed entirely.
 */
const WAKE_TIMEOUT_MS = 3_000;

export async function wakeJobs() {
  const url = Deno.env.get("JOBS_WAKE_URL")?.trim();
  const secret = Deno.env.get("JOBS_WAKE_SECRET")?.trim();
  if (!url || !secret) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "x-jobs-secret": secret,
        "user-agent": "drama-space-jobs-wake/1.0",
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
  } catch {
    /* cron is the fallback */
  }
}
