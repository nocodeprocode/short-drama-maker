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
    });
  } catch {
    /* cron is the fallback */
  }
}
