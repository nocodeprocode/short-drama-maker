import { describe, expect, it } from "vitest";
import {
  actionLabel,
  captionCues,
  compactProductionLog,
  CTA,
  currentTaskFailure,
  deskActivityCopy,
  downloadBasename,
  episodeStripStates,
  greetingName,
  homeShows,
  isPlayableFeedKind,
  nextActionLabel,
  nextCutIndex,
  assembledEpisodeUrl,
  playableShotUrls,
  seriesNextAction,
  shotGridCounts,
  sortShotVideoRows,
  statusLabel,
  studioPlayerMode,
  usd,
  usdLabel,
  watchLinksForEpisodes,
} from "./present.ts";

describe("presentation", () => {
  it("title-cases job actions instead of dumping snake_case", () => {
    expect(actionLabel("design_voice")).toBe("Design the voice");
    expect(actionLabel("generate_appearance")).toBe("Create character stills");
    expect(actionLabel("advance_production")).toBe("Move production forward");
  });

  it("never shows Running while paused", () => {
    expect(statusLabel("running", true)).toBe("Paused");
    expect(statusLabel("running", false)).toBe("Shooting");
    expect(statusLabel("generating")).toBe("Shooting");
    expect(statusLabel("complete")).toBe("Ready");
    expect(statusLabel("awaiting_payment")).toBe("Waiting for payment");
  });

  it("rounds ledger floats to cents", () => {
    expect(usd(75.33999999999997)).toBe(75.34);
    expect(usdLabel(75.97999999999999)).toBe("75.98");
  });

  it("does not show shoot-the-scene as done before a finished shot exists", () => {
    const log = compactProductionLog(
      [
        {
          id: "t1",
          action: "generate_video",
          status: "done",
          status_label: "Done",
          title: "Shoot the scene",
          updated_at: "2026-08-31T00:00:00.000Z",
        },
      ],
      [],
      { hasFinishedShot: false },
    );
    expect(log[0]?.status).toBe("running");
    expect(log[0]?.status_label).toBe("Shooting");
    const ready = compactProductionLog(
      [
        {
          id: "t1",
          action: "generate_video",
          status: "done",
          status_label: "Done",
          title: "Shoot the scene",
          updated_at: "2026-08-31T00:00:00.000Z",
        },
      ],
      [],
      { hasFinishedShot: true },
    );
    expect(ready[0]?.status).toBe("done");
  });

  it("ignores old failed 400s while the production is still running", () => {
    const tasks = [
      { status: "done" as const, error_code: null },
      { status: "failed" as const, error_code: "The image studio returned HTTP 400 on /videos." },
    ];
    expect(currentTaskFailure(tasks, "running")).toBeNull();
    expect(currentTaskFailure(tasks, "needs_user")?.error_code).toMatch(/HTTP 400/);
    expect(
      currentTaskFailure(
        [{ status: "queued", error_code: "A reference frame was rejected. We are retrying this step." }],
        "running",
      )?.error_code,
    ).toMatch(/reference frame/);
  });

  it("shows cutting or ready on the desk instead of a forever Working now", () => {
    expect(
      deskActivityCopy({ status: "producing", ui_phase: "producing", busyVideo: false, hasTakes: true }),
    ).toMatchObject({ state: "cutting", title: "Cutting the episode" });
    expect(deskActivityCopy({ status: "ready" })).toMatchObject({ state: "ready", title: "Ready to watch" });
    expect(
      deskActivityCopy({ status: "running", ui_phase: "producing", busyVideo: true, hasTakes: true }),
    ).toMatchObject({ state: "watching", title: "Working now" });
  });

  it("never asks a paid series to pay for the pilot again", () => {
    expect(
      seriesNextAction({
        pilot_approved: false,
        productions: [{ id: "p1", status: "needs_user", paid_amount: 76 }],
      }),
    ).toEqual({ next_action: "open_production", active_production_id: "p1" });
    expect(
      seriesNextAction({
        pilot_approved: false,
        productions: [
          { id: "unpaid", status: "awaiting_payment", paid_amount: 0 },
          { id: "paid", status: "running", paid_amount: 76 },
        ],
      }),
    ).toEqual({ next_action: "open_production", active_production_id: "paid" });
    expect(
      seriesNextAction({
        pilot_approved: false,
        productions: [{ id: "ready", status: "ready", paid_amount: 76 }],
      }),
    ).toEqual({ next_action: "approve_pilot", active_production_id: "ready" });
    expect(
      seriesNextAction({
        pilot_approved: false,
        productions: [],
      }),
    ).toEqual({ next_action: "pay_pilot", active_production_id: null });
  });

  it("keeps every shot_video in episode order and drops the finished-episode bag", () => {
    const rows = [
      { id: "final", kind: "episode_final", metadata: { episode_number: 1 } },
      { id: "e2s1", kind: "shot_video", metadata: { episode_number: 2, shot_position: 1 } },
      { id: "e1s2", kind: "shot_video", metadata: { episode_number: 1, shot_position: 2 } },
      { id: "still", kind: "character_reference", metadata: {} },
      { id: "e1s1", kind: "shot_video", metadata: { episode_number: 1, shot_position: 1 } },
    ];
    const extras = Array.from({ length: 40 }, (_, index) => ({
      id: `voice-${index}`,
      kind: "voice_preview",
      metadata: {},
    }));
    const playable = sortShotVideoRows([...rows, ...extras].filter((row) => isPlayableFeedKind(row.kind)));
    expect(playable.map((row) => row.id)).toEqual(["e1s1", "e1s2", "e2s1"]);
    expect(playable.some((row) => row.kind === "episode_final")).toBe(false);
  });

  it("exposes a watch URL for each complete episode", () => {
    expect(
      watchLinksForEpisodes([
        { id: "ep-2", episode_number: 2, status: "complete" },
        { id: "ep-1", episode_number: 1, status: "complete" },
        { id: "ep-3", episode_number: 3, status: "planned" },
      ]),
    ).toEqual([
      { episode_number: 1, href: "/episodes/ep-1/studio", label: CTA.watchEpisode(1) },
      { episode_number: 2, href: "/episodes/ep-2/studio", label: CTA.watchEpisode(2) },
    ]);
  });

  it("uses one human greeting and never says there", () => {
    expect(greetingName("Mei Chen")).toBe("Mei");
    expect(greetingName("there")).toBeNull();
    expect(greetingName("")).toBeNull();
    expect(greetingName(null)).toBeNull();
  });

  it("maps next actions to the product CTAs", () => {
    expect(nextActionLabel("pay_pilot")).toBe("Start the pilot");
    expect(nextActionLabel("open_production")).toBe("Watch live");
    expect(nextActionLabel("approve_pilot")).toBe("Approve the cast");
    expect(nextActionLabel("buy_next_block")).toBe("Order more episodes");
  });

  it("turns episode and shot rows into progress primitives", () => {
    expect(
      episodeStripStates([
        { episode_number: 1, status: "complete" },
        { episode_number: 2, status: "generating" },
        { episode_number: 3, status: "planned" },
      ]),
    ).toEqual({ 1: "done", 2: "gen", 3: "" });
    expect(
      shotGridCounts([
        { status: "complete" },
        { status: "generating" },
        { status: "needs_review" },
        { status: "queued" },
        { video_url: "https://media.example/shot.mp4" },
      ]),
    ).toEqual({ approved: 2, generating: 1, review: 1, queued: 1 });
  });

  it("only treats spoken lines as caption cues and names download files", () => {
    expect(
      captionCues([
        { id: "s1", shot_data: { speaker: "Mei", dialogue: "Stay." } },
        { id: "s2", shot_data: { dialogue: "   " } },
      ]),
    ).toEqual([{ id: "s1", who: "Mei", text: "Stay." }]);
    expect(playableShotUrls([{ position: 2, video_url: "b.mp4" }, { position: 1, video_url: "a.mp4" }, { position: 3 }])).toEqual([
      { position: 1, url: "a.mp4" },
      { position: 2, url: "b.mp4" },
    ]);
    expect(downloadBasename("The Night Ledger", 2)).toBe("the-night-ledger-ep-02");
    expect(nextCutIndex(0, 5)).toBe(1);
    expect(nextCutIndex(4, 5)).toBe(4);
    expect(assembledEpisodeUrl("https://cdn/ep.mp4")).toBe("https://cdn/ep.mp4");
    expect(assembledEpisodeUrl("  ")).toBeNull();
  });

  it("rolls Home up to one card per show, never per episode", () => {
    const shows = homeShows({
      series: [
        { id: "s1", title: "The Night Ledger", status: "ready", poster_tone: "g1" },
        { id: "s2", title: "The Night Desk", status: "draft", poster_tone: "g2" },
      ],
      in_production: [
        {
          id: "p1",
          series_id: "s1",
          series_title: "The Night Ledger",
          status: "running",
          paused: false,
          ui_phase: "producing",
          episode_start: 1,
          episode_end: 2,
        },
      ],
      ready_to_publish: [
        { series_id: "s1", series_title: "The Night Ledger", episode_number: 1 },
        { series_id: "s1", series_title: "The Night Ledger", episode_number: 2 },
      ],
    });
    expect(shows).toHaveLength(2);
    expect(shows[0]).toMatchObject({
      id: "s1",
      title: "The Night Ledger",
      status: "running",
      ready_count: 2,
      href: "/productions/p1",
      episode_end: 2,
    });
    expect(shows[1]).toMatchObject({ id: "s2", title: "The Night Desk", href: "/series/s2" });

    const readyOnly = homeShows({
      series: [{ id: "s1", title: "The Night Ledger", status: "ready", poster_tone: "g1" }],
      in_production: [],
      ready_to_publish: [
        { series_id: "s1", episode_number: 1 },
        { series_id: "s1", episode_number: 2 },
      ],
    });
    expect(readyOnly).toHaveLength(1);
    expect(readyOnly[0]).toMatchObject({ status: "ready", ready_count: 2, href: "/series/s1" });
  });

  it("plays a take instead of the shooting spinner when a video URL exists", () => {
    expect(studioPlayerMode({ video_url: "https://media.example/shot.mp4", status: "generating" })).toBe("player");
    expect(studioPlayerMode({ video_url: "https://media.example/shot.mp4", status: "complete" })).toBe("player");
    expect(studioPlayerMode({ video_url: null, status: "generating" })).toBe("shooting");
    expect(studioPlayerMode({ video_url: null, status: "complete" })).toBe("poster");
  });
});
