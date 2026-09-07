import { describe, expect, it } from "vitest";
import { cliffShapeFor, isLoopOpener, seasonMovementFor } from "./micro-drama.ts";

describe("season shape", () => {
  it("rotates cliff shapes, pins milestones, and marks loop openers", () => {
    expect(cliffShapeFor(1)).toBe("revelation");
    expect(cliffShapeFor(2)).toBe("reversal");
    expect(cliffShapeFor(3)).toBe("deadline");
    expect(cliffShapeFor(4)).toBe("intrusion");
    expect(cliffShapeFor(10)).toBe("revelation");
    expect(cliffShapeFor(30)).toBe("reversal");
    expect(cliffShapeFor(48)).toBe("deadline");
    expect(cliffShapeFor(60)).toBe("revelation");
    for (let n = 2; n <= 60; n += 1) {
      if (![10, 30, 48, 60].includes(n) && ![10, 30, 48, 60].includes(n - 1)) expect(cliffShapeFor(n)).not.toBe(cliffShapeFor(n - 1));
    }
    expect(seasonMovementFor(2).movement).toBe("hook");
    expect(seasonMovementFor(20).movement).toBe("escalation");
    expect(seasonMovementFor(58).movement).toBe("payoff");
    expect(isLoopOpener(1)).toBe(true);
    expect(isLoopOpener(7)).toBe(true);
    expect(isLoopOpener(8)).toBe(false);
  });
});
import {
  channelMix,
  channelMixOk,
  channelOf,
  coreExpectationFrom,
  isOneSentence,
  loopForEpisode,
  MICRO_EPISODE,
  MICRO_PAYWALL_EPISODE,
} from "./micro-drama.ts";

describe("micro-drama blueprint", () => {
  it("classifies sync, VO, and silent", () => {
    expect(channelOf({ dialogue: "Put it down.", audio_role: "onscreen" })).toBe("sync");
    expect(channelOf({ dialogue: "He signed it.", audio_role: "offscreen" })).toBe("vo");
    expect(channelOf({ dialogue: null, audio_role: "silent" })).toBe("silent");
  });

  it("accepts a 40/30/30 mix and rejects a stage-play", () => {
    const shots = [
      ...Array.from({ length: 8 }, () => ({ dialogue: "Stay.", audio_role: "onscreen" as const })),
      ...Array.from({ length: 6 }, () => ({ dialogue: "He knew.", audio_role: "offscreen" as const })),
      ...Array.from({ length: 6 }, () => ({ dialogue: null, audio_role: "silent" as const })),
    ];
    expect(channelMixOk(channelMix(shots))).toBe(true);
    const play = Array.from({ length: 20 }, () => ({ dialogue: "Stay.", audio_role: "onscreen" as const }));
    expect(channelMixOk(channelMix(play))).toBe(false);
  });

  it("enforces one sentence on sync", () => {
    expect(isOneSentence("Put the letter down.")).toBe(true);
    expect(isOneSentence("Put it down. Then look at me.")).toBe(false);
  });

  it("places the paywall inside loop 2 and states a core expectation", () => {
    expect(MICRO_PAYWALL_EPISODE).toBe(10);
    expect(loopForEpisode(10).loop).toBe(2);
    expect(coreExpectationFrom("A dated letter names the wrong bride.")).toMatch(/\?$/);
    expect(MICRO_EPISODE.min_shots).toBe(4);
    expect(MICRO_EPISODE.max_shots).toBe(6);
  });
});
