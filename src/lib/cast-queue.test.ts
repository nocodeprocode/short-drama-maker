import { describe, expect, it } from "vitest";
import { packPercent, queueLabel, queuePlaces } from "./cast-queue.ts";

const slot = (id: string, actor_status: string) => ({ id, actor_status }) as Parameters<typeof queuePlaces>[0][number];

/**
 * A show's faces are generated one part at a time, so a three-actor slate is a
 * seven-minute job. Every card used to read "Building · 0/4" the whole way
 * through, whether it was working, waiting behind two others, or wedged, which is
 * why an ordinary queue was reported as nothing happening at all.
 */
describe("cast queue", () => {
  it("puts the running part first no matter where it sits on the slate", () => {
    const places = queuePlaces([
      slot("waiting-first", "queued"),
      slot("working", "running"),
      slot("waiting-last", "queued"),
    ]);
    expect(places.get("working")).toBe(1);
    expect(places.get("waiting-first")).toBe(2);
    expect(places.get("waiting-last")).toBe(3);
  });

  it("ignores parts that are already done or were never started", () => {
    const places = queuePlaces([slot("done", "ready"), slot("idle", "idle"), slot("working", "running")]);
    expect(places.has("done")).toBe(false);
    expect(places.has("idle")).toBe(false);
    expect(places.get("working")).toBe(1);
  });

  it("tells a waiting part how many are ahead of it", () => {
    expect(queueLabel(2)).toBe("Next up");
    expect(queueLabel(3)).toBe("Waiting · 2 ahead");
    expect(queueLabel(5)).toBe("Waiting · 4 ahead");
  });

  it("does not claim a position when nothing is ahead", () => {
    expect(queueLabel(1)).toBe("Waiting its turn");
    expect(queueLabel(undefined)).toBe("Waiting its turn");
  });

  it("reports no percentage until the first still lands", () => {
    expect(packPercent(0, 4)).toBeUndefined();
    expect(packPercent(undefined, 4)).toBeUndefined();
    expect(packPercent(2, 0)).toBeUndefined();
    expect(packPercent(1, 4)).toBe(25);
    expect(packPercent(4, 4)).toBe(100);
    expect(packPercent(9, 4)).toBe(100);
  });
});
