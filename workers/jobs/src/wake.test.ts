import { describe, expect, it } from "vitest";
import { mediaRunnerConfigured, mediaWakeRequest, wakeMediaRunner } from "./wake.ts";

describe("media runner wake", () => {
  it("does nothing until both the token and a target exist", () => {
    expect(mediaWakeRequest({})).toBeNull();
    expect(mediaWakeRequest({ MEDIA_WORKER_TOKEN: "tok" })).toBeNull();
    expect(mediaWakeRequest({ MEDIA_WORKER_URL: "https://media.example" })).toBeNull();
    expect(mediaRunnerConfigured({ MEDIA_WORKER_TOKEN: "tok", MEDIA_WORKER_URL: "https://media.example" })).toBe(true);
  });

  it("posts /jobs with the bearer token", () => {
    const request = mediaWakeRequest({
      MEDIA_WORKER_TOKEN: "tok",
      MEDIA_WORKER_URL: "https://short-drama-media-worker.example/",
    });
    expect(request?.input).toBe("https://short-drama-media-worker.example/jobs");
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toMatchObject({ authorization: "Bearer tok" });
  });

  it("prefers a service binding when one is wired", () => {
    const request = mediaWakeRequest({
      MEDIA_WORKER_TOKEN: "tok",
      MEDIA_WORKER_URL: "https://public.example",
      MEDIA_RUNNER: { fetch: async () => new Response() },
    });
    expect(request?.input).toBe("https://media-runner.internal/jobs");
  });

  it("hands the fetch to waitUntil and swallows a down runner", async () => {
    const pending: Promise<unknown>[] = [];
    const woke = wakeMediaRunner(
      {
        MEDIA_WORKER_TOKEN: "tok",
        MEDIA_RUNNER: {
          fetch: async () => {
            throw new Error("container cold");
          },
        },
      },
      (promise) => pending.push(promise),
    );
    expect(woke).toBe(true);
    await expect(pending[0]).resolves.toBeUndefined();
  });
});
