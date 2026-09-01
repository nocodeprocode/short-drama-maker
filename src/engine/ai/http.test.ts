import { beforeEach, describe, expect, it } from "vitest";
import {
  BREAKER_THRESHOLD,
  ProviderCircuitOpenError,
  ProviderHttpError,
  ProviderTimeoutError,
  breakerStatus,
  providerFetch,
  resetBreakers,
  retryAfterMs,
} from "./http.ts";

function response(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

const noSleep = async () => {};

describe("providerFetch", () => {
  beforeEach(() => resetBreakers());

  it("retries transient statuses, honours Retry-After, and returns the first success", async () => {
    const seen: number[] = [];
    const slept: number[] = [];
    let calls = 0;
    const res = await providerFetch(
      "https://api.example/v1/thing",
      { method: "GET" },
      { provider: "p", retries: 3 },
      {
        fetch: async () => {
          calls += 1;
          seen.push(calls);
          if (calls === 1) return response(429, "slow down", { "retry-after": "2" });
          if (calls === 2) return response(503, "busy");
          return response(200, "ok");
        },
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );
    expect(await res.text()).toBe("ok");
    expect(seen).toEqual([1, 2, 3]);
    expect(slept[0]).toBe(2000);
    expect(breakerStatus("p").failures).toBe(0);
  });

  it("does not retry a non-idempotent POST or a 4xx", async () => {
    let calls = 0;
    await expect(
      providerFetch("https://api.example/v1/videos", { method: "POST" }, { provider: "p", retries: 3 }, {
        fetch: async () => {
          calls += 1;
          return response(503, "busy");
        },
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(calls).toBe(1);

    calls = 0;
    await expect(
      providerFetch("https://api.example/v1/x", { method: "GET" }, { provider: "p", retries: 3 }, {
        fetch: async () => {
          calls += 1;
          return response(400, "bad request");
        },
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ status: 400, transient: false });
    expect(calls).toBe(1);
  });

  it("retries an idempotent POST", async () => {
    let calls = 0;
    const res = await providerFetch(
      "https://api.example/v1/chat",
      { method: "POST", body: "{}" },
      { provider: "p", retries: 2, idempotent: true },
      {
        fetch: async () => {
          calls += 1;
          return calls < 2 ? response(502, "gateway") : response(200, "done");
        },
        sleep: noSleep,
      },
    );
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });

  it("times out a hung request and reports it as a timeout", async () => {
    await expect(
      providerFetch("https://api.example/v1/hang", { method: "GET" }, { provider: "p", retries: 0, timeoutMs: 20 }, {
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("opens the breaker after repeated failures and fails fast while open", async () => {
    const failing = async () => response(500, "down");
    for (let i = 0; i < BREAKER_THRESHOLD; i += 1) {
      await providerFetch("https://api.example/v1/x", { method: "GET" }, { provider: "down", retries: 0 }, {
        fetch: failing,
        sleep: noSleep,
      }).catch(() => undefined);
    }
    expect(breakerStatus("down").open).toBe(true);
    let called = false;
    await expect(
      providerFetch("https://api.example/v1/x", { method: "GET" }, { provider: "down" }, {
        fetch: async () => {
          called = true;
          return response(200);
        },
      }),
    ).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(called).toBe(false);
    // Another provider is unaffected.
    const ok = await providerFetch("https://api.example/v1/y", { method: "GET" }, { provider: "up" }, {
      fetch: async () => response(200, "fine"),
    });
    expect(ok.ok).toBe(true);
  });

  it("parses Retry-After in seconds and as a date, capped", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs("900")).toBe(30_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
  });
});
