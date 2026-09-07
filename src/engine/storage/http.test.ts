import { afterEach, describe, expect, it } from "vitest";
import { setAssetFetch } from "./fetch.ts";
import { HttpAssetStore } from "./http.ts";

afterEach(() => setAssetFetch(null));

function putInput() {
  return {
    id: "asset-1",
    owner_id: "owner",
    series_id: "series",
    kind: "character_reference" as const,
    bucket: "private-character" as const,
    storage_path: "private-character/series/asset-1.png",
    mime_type: "image/png",
    body: new Uint8Array([1, 2, 3]),
    checksum: "abc",
    metadata: {},
    created_at: new Date().toISOString(),
  };
}

const store = () => new HttpAssetStore({ baseUrl: "https://media.test", signingSecret: "s", token: "t" });

describe("http asset store writes", () => {
  it("retries an object write the store failed on its own", async () => {
    let calls = 0;
    setAssetFetch(async () => {
      calls += 1;
      // R2 dresses its internal faults as a 400 with a code in the body.
      return calls === 1
        ? new Response('{"error":"put: We encountered an internal error. (10001)"}', { status: 400 })
        : new Response("", { status: 200 });
    });
    const asset = await store().put(putInput());
    expect(calls).toBe(2);
    expect(asset.id).toBe("asset-1");
  });

  it("gives up on a write the store will never accept", async () => {
    let calls = 0;
    setAssetFetch(async () => {
      calls += 1;
      return new Response('{"error":"unsupported content type"}', { status: 400 });
    });
    await expect(store().put(putInput())).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });
});
