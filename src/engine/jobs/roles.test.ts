import { describe, expect, it } from "vitest";
import { excludedActionsFor, runnerRole } from "./runner.ts";

describe("hosted runner roles", () => {
  it("keeps ffmpeg work off the Cloudflare orchestrator Worker", () => {
    expect(runnerRole({ RUNNER_ROLE: "orchestrator" })).toBe("orchestrator");
    const excluded = excludedActionsFor("orchestrator") ?? [];
    expect(excluded).toEqual(
      expect.arrayContaining(["generate_video", "regenerate_shot", "rejudge_shot", "render_episode", "tick", "reconcile"]),
    );
    expect(excluded).not.toContain("plan_episode");
    expect(excluded).not.toContain("generate_dialogue");
  });

  it("keeps planning off the media container", () => {
    expect(runnerRole({ RUNNER_ROLE: "media" })).toBe("media");
    const excluded = excludedActionsFor("media") ?? [];
    expect(excluded).toEqual(
      expect.arrayContaining(["plan_episode", "generate_dialogue", "analyze", "advance_production"]),
    );
    expect(excluded).not.toContain("generate_video");
    expect(excluded).not.toContain("render_episode");
    expect(excluded).not.toContain("tick");
  });

  it("defaults a bare host to both roles", () => {
    expect(runnerRole({})).toBe("all");
    expect(excludedActionsFor("all")).toBeNull();
  });
});
