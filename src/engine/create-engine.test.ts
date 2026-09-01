import { describe, expect, it } from "vitest";
import { ContentBlockedError } from "./ai/moderation.ts";
import { createAiGateway, type AIGateway } from "./ai/index.ts";
import { DuplicateStripeEventError } from "./ledger/budget.ts";
import { createEngine, RenderIncompleteError } from "./create-engine.ts";
import { RenderFailedError } from "./media/render.ts";
import type { MuxAuditFn } from "./media/mux-audit.ts";
import type { TakeAnalysis } from "./pipeline/take-analysis.ts";
import { buildEpisodeVtt, renderEpisodeBytes, type RenderFn } from "./media/render.ts";
import { concatBytes, decodeJson, encodeJson, sha256Hex } from "./crypto.ts";
import type { AlignmentTrack, EpisodePlan, StoryBible, VoiceCandidate } from "./domain.ts";
import { SCREENPLAY_RULES } from "./domain.ts";
import { buildPortraitMp4 } from "./media/mp4.ts";
import { MemoryAssetStore } from "./storage/memory.ts";

function alignmentFor(text: string, duration: number): AlignmentTrack {
  const characters = [...text];
  const step = characters.length === 0 ? duration : duration / characters.length;
  const chars = characters.map((char, index) => ({
    char,
    start: index * step,
    end: (index + 1) * step,
  }));
  const words = [...text.matchAll(/\S+/g)].map((match) => {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;
    return {
      word: match[0],
      start: chars[startIndex]?.start ?? 0,
      end: chars[endIndex - 1]?.end ?? duration,
    };
  });
  return { text, characters: chars, words };
}

const TEST_BIBLE: StoryBible = {
  title: "Forbidden Billionaire",
  logline: "A confrontation after a three-month lie.",
  characters: [
    {
      name: "Sarah Morgan",
      description: "Fictional lead.",
      appearance: {
        age_look: "late twenties",
        ethnicity_notes: "unspecified fictional",
        hair: "dark",
        face: "sharp",
        body: "average height",
        default_wardrobe: "black silk blouse",
      },
      personality: { core: "principled" },
      relationships: { david: "partner" },
      voice_design_prompt: "Female, late twenties, conversational American English.",
    },
    {
      name: "David Chen",
      description: "Fictional counterpart.",
      appearance: {
        age_look: "early thirties",
        ethnicity_notes: "unspecified fictional",
        hair: "black",
        face: "open",
        body: "tall",
        default_wardrobe: "open collar shirt",
      },
      personality: { core: "evasive" },
      relationships: { sarah: "partner" },
      voice_design_prompt: "Male, early thirties, warm baritone.",
    },
    {
      name: "Nora Hale",
      description: "Fictional witness. The night concierge who buzzed someone up.",
      appearance: {
        age_look: "early thirties",
        ethnicity_notes: "unspecified fictional",
        hair: "black",
        face: "calm",
        body: "average height",
        default_wardrobe: "navy high-neck knit",
      },
      personality: { core: "observant" },
      relationships: { sarah: "building staff" },
      voice_design_prompt: "Female, early thirties, even and brief.",
    },
  ],
  locations: ["penthouse kitchen"],
  episode_structure: [{ episode_number: 1, title: "You Knew", hook: "The timeline", conflict: "The lie" }],
  visual_style: { format: "9:16" },
  rules: SCREENPLAY_RULES,
};

const TEST_PLAN: EpisodePlan = {
  title: "You Knew",
  hook: "Three months.",
  conflict: "The affair is no longer deniable.",
  cliffhanger: "The elevator opens on someone they both know.",
  scenes: [
    {
      location: "penthouse kitchen",
      time: "night",
      characters: ["sarah", "david", "nora"],
      shots: [
        {
          type: "dialogue",
          speaker: "sarah",
          dialogue: "How long has this been going on?",
          emotion: "furious_but_controlled",
          delivery: "quiet",
          pace: "slow",
          camera: "medium close-up, conflict already in motion",
          mouth_visibility_required: true,
          duration_hint_seconds: 7,
          function: "hook_cu",
          audio_role: "onscreen",
          edit_mode: "locked_take",
          eyeline: "lens_forbidden",
        },
        {
          type: "dialogue",
          speaker: "david",
          dialogue: "Don't do this here.",
          emotion: "caught",
          delivery: "quiet",
          pace: "fast",
          camera: "close-up",
          mouth_visibility_required: true,
          duration_hint_seconds: 6,
          function: "accusation_cu",
          audio_role: "onscreen",
        },
        {
          type: "reaction",
          speaker: "sarah",
          dialogue: "Three months is a confession.",
          emotion: "listening",
          delivery: null,
          pace: null,
          camera: "listener close-up",
          mouth_visibility_required: false,
          duration_hint_seconds: 6,
          function: "listener_hold",
          audio_role: "offscreen",
          speaker_on_camera: "sarah",
          speakers_off_camera: ["david"],
        },
        {
          type: "broll",
          speaker: null,
          dialogue: null,
          emotion: null,
          delivery: null,
          pace: null,
          camera: "insert of the phone with the dated message",
          mouth_visibility_required: false,
          duration_hint_seconds: 5,
          function: "insert_evidence",
          audio_role: "silent",
        },
        {
          type: "dialogue",
          speaker: "david",
          dialogue: "Three months.",
          emotion: "shame",
          delivery: "flat",
          pace: "slow",
          camera: "close-up",
          mouth_visibility_required: true,
          duration_hint_seconds: 5,
          function: "accusation_cu",
          audio_role: "onscreen",
        },
        {
          type: "reaction",
          speaker: "sarah",
          dialogue: null,
          emotion: "the number lands",
          delivery: null,
          pace: null,
          camera: "close-up, the line lands",
          mouth_visibility_required: false,
          duration_hint_seconds: 2.5,
          function: "reaction",
          audio_role: "silent",
          silence_license: "post_nuke",
          speaker_on_camera: "sarah",
        },
        {
          type: "dialogue",
          speaker: "david",
          dialogue: "Sarah, please.",
          emotion: "pleading",
          delivery: "too familiar",
          pace: "medium",
          camera: "medium close-up",
          mouth_visibility_required: true,
          duration_hint_seconds: 6,
          function: "accusation_cu",
          audio_role: "onscreen",
        },
        {
          type: "dialogue",
          speaker: "sarah",
          dialogue: "Don't say my name.",
          emotion: "cold",
          delivery: "a door closing",
          pace: "slow",
          camera: "medium close-up",
          mouth_visibility_required: true,
          duration_hint_seconds: 6,
          function: "slap_peak",
          audio_role: "onscreen",
          hero: true,
        },
        {
          type: "hero",
          speaker: "sarah",
          dialogue: "Get out of my kitchen.",
          emotion: "final",
          delivery: "quiet",
          pace: "slow",
          camera: "doorway reveal as the elevator chimes",
          mouth_visibility_required: true,
          duration_hint_seconds: 6,
          function: "doorway_reveal",
          audio_role: "onscreen",
        },
        {
          type: "hero",
          speaker: "sarah",
          dialogue: "Who is she?",
          emotion: "unresolved",
          delivery: "cut before the answer",
          pace: "slow",
          camera: "freeze on her face as the doors open",
          mouth_visibility_required: true,
          duration_hint_seconds: 5,
          function: "button_cu",
          audio_role: "onscreen",
        },
      ],
    },
  ],
};

function testGateway(): AIGateway {
  const jobs = new Map<string, { status: "pending" | "completed"; duration: number }>();
  let voices = 0;
  return createAiGateway({
    // Synthetic takes have no decodable frames; the stage skips before any judge call.
    vision: {
      async judgeIdentity() {
        return { same_person: 0.95, face_count: 1, notes: "test", model: "test" };
      },
    },
    llm: {
      async analyzeStory() {
        return TEST_BIBLE;
      },
      async writeEpisode() {
        return TEST_PLAN;
      },
      async planShots(input) {
        return input.plan;
      },
    },
    image: {
      async generateReference() {
        return { bytes: new Uint8Array([137, 80, 78, 71]), mime_type: "image/png" };
      },
      async generateReferenceFromSeed() {
        return { bytes: new Uint8Array([137, 80, 78, 71]), mime_type: "image/png" };
      },
    },
    speech: {
      async designVoice() {
        const candidate: VoiceCandidate = {
          preview_id: "preview_a",
          elevenlabs_voice_id: "gen_voice_a",
          preview_label: "A",
          preview_audio_bytes: new Uint8Array([1, 2, 3, 4]),
          preview_mime_type: "audio/mpeg",
        };
        return [candidate];
      },
      async saveVoice(candidate) {
        voices += 1;
        return {
          elevenlabs_voice_id: `el_saved_${voices}_${candidate.elevenlabs_voice_id}`,
          canonical_reference_asset_id: "",
          voice_version: 1,
        };
      },
      async synthesize(_voice, dialogue) {
        const duration = 3.3;
        return {
          audio: {
            bytes: new TextEncoder().encode(dialogue.text),
            mime_type: "audio/mpeg",
            duration_seconds: duration,
          },
          alignment: { json: alignmentFor(dialogue.text, duration), mime_type: "application/json" },
        };
      },
    },
    video: {
      async submit(request) {
        const offscreen =
          request.shot.shot_data.audio_role === "offscreen" ||
          request.shot.shot_data.function === "listener_hold" ||
          request.shot.shot_data.audio_role === "silent";
        if (request.shot.shot_data.dialogue && !request.audio_reference_url && !offscreen) {
          throw new Error("Dialogue video requires a real dialogue-audio URL");
        }
        const upstream_job_id = `orv_${jobs.size + 1}`;
        jobs.set(upstream_job_id, {
          status: "completed",
          duration: request.duration_seconds ?? 4,
        });
        return { upstream_job_id, provider: "openrouter", model: request.model };
      },
      async getStatus(job) {
        const row = jobs.get(job.upstream_job_id ?? "");
        return {
          upstream_job_id: job.upstream_job_id ?? "",
          status: row?.status === "completed" ? "completed" : "pending",
          output_url: null,
          actual_cost: 0.12,
          error: null,
        };
      },
      async download(job) {
        const duration = jobs.get(job.upstream_job_id ?? "")?.duration ?? 4;
        return { bytes: buildPortraitMp4(duration), mime_type: "video/mp4" };
      },
    },
  });
}

/**
 * Deterministic stand-in for the ffmpeg mixer: the synthetic takes built by
 * `buildPortraitMp4` carry no decodable samples, so the real renderer would
 * (correctly) fail closed on them.
 */
const fakeRender: RenderFn = async (input) => {
  const vtt = buildEpisodeVtt(input);
  const body = concatBytes([
    new TextEncoder().encode("\0\0\0\x18ftypisom"),
    encodeJson(input.manifest),
    ...input.shotBodies,
    new TextEncoder().encode(vtt),
  ]);
  return { body, checksum: await sha256Hex(body), vtt, container: "mp4" };
};

const passingAudit: MuxAuditFn = async (input) => ({
  version: 1,
  ship: true,
  reasons: [],
  duration_seconds: 0,
  expected_duration_seconds: 0,
  has_audio: true,
  black_frames: 0,
  integrated_lufs: -14,
  true_peak_dbfs: -1.2,
  loudness_range_lu: 8,
  lines: input.manifest.shots.map((shot) => ({
    shot_id: shot.shot_id,
    speaker: shot.speaker ?? null,
    picture_start_s: shot.picture_start_seconds ?? 0,
    expected_voice_s: 0,
    voice_onset_s: null,
    mouth_open_s: null,
    lag_ms: 0,
    limit_ms: 80,
    pass: true,
    head_step: 0,
    settled_open: true,
  })),
  measured_at: "t",
});

function engine(overrides: Partial<Parameters<typeof createEngine>[0]> = {}) {
  return createEngine({
    dailyCap: 1000,
    ai: testGateway(),
    assets: new MemoryAssetStore(),
    render: fakeRender,
    audit: passingAudit,
    ...overrides,
  });
}

async function fundedSeries() {
  const app = engine();
  const series = await app.createSeries({
    owner_id: "user-1",
    title: "Forbidden Billionaire",
    description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
  });
  await app.handleStripeWebhook({
    event_id: "evt_1",
    signature_valid: true,
    type: "checkout.session.completed",
    payment_status: "paid",
    series_id: series.id,
    owner_id: "user-1",
    amount: 25,
  });
  const analyzed = await app.analyze({ owner_id: "user-1", series_id: series.id });
  for (const character of analyzed.characters) {
    await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
  }
  const episode = await app.createEpisode({
    owner_id: "user-1",
    series_id: series.id,
    episode_number: 1,
    title: "You Knew",
  });
  const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
  return { app, series, episode: planned.episode, shots: planned.shots };
}

describe("engine phase 0", () => {
  it("refuses to start without a fetchable asset store", () => {
    const url = process.env.MEDIA_STORE_URL;
    const secret = process.env.MEDIA_SIGNING_SECRET;
    const token = process.env.MEDIA_STORE_TOKEN;
    const dir = process.env.ASSET_DIR;
    delete process.env.MEDIA_STORE_URL;
    delete process.env.MEDIA_SIGNING_SECRET;
    delete process.env.MEDIA_STORE_TOKEN;
    delete process.env.ASSET_DIR;
    try {
      expect(() => createEngine({ ai: testGateway() })).toThrow(/No fetchable asset store/);
    } finally {
      if (url) process.env.MEDIA_STORE_URL = url;
      if (secret) process.env.MEDIA_SIGNING_SECRET = secret;
      if (token) process.env.MEDIA_STORE_TOKEN = token;
      if (dir) process.env.ASSET_DIR = dir;
    }
  });

  it("blocks a real-person story before any provider call", async () => {
    const app = engine();
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Celebrity Drama",
      description: "Make the lead look like Zendaya.",
    });
    await expect(app.analyze({ owner_id: "user-1", series_id: series.id })).rejects.toBeInstanceOf(
      ContentBlockedError,
    );
    expect(app.store.characters.size).toBe(0);
    expect([...app.store.jobs.values()]).toHaveLength(0);
  });

  it("finalizes dialogue duration from the wav, then generates independently regenerable shots", async () => {
    const { app, episode, shots, series } = await fundedSeries();
    const dialogue = shots.find((shot) => shot.shot_data.dialogue === "Three months.");
    expect(dialogue).toBeTruthy();

    const audio = await app.generateDialogue({ owner_id: "user-1", shot_id: dialogue!.id });
    expect(audio.shot.shot_data.duration_seconds).toBeGreaterThanOrEqual(4);
    expect(audio.shot.shot_data.dialogue_alignment_asset_id).toBeTruthy();

    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    const dialogueJob = [...app.store.jobs.values()].find(
      (job) => job.shot_id === dialogue!.id && job.job_type === "video",
    );
    expect(String(dialogueJob?.request_metadata.prompt)).toMatch(/modestly dressed/i);
    expect(String(dialogueJob?.request_metadata.prompt)).toMatch(/Audio 1/);
    await app.tick();

    const complete = app.store.shotsForEpisode(episode.id);
    expect(complete.every((shot) => shot.status === "complete")).toBe(true);

    const first = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    const second = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(first.checksum).toBe(second.checksum);
    expect(first.episode.render_manifest).toEqual(second.episode.render_manifest);
    expect(first.vtt).toMatch(/WEBVTT/);
    expect(first.episode.render_manifest?.scenes?.length).toBeGreaterThan(0);
    expect(first.episode.render_manifest?.shots.some((shot) => shot.picture_start_seconds != null)).toBe(true);

    const before = app.store.shotsForEpisode(episode.id).map((shot) => shot.selected_generation_id);
    const target = complete[0]!;
    await app.regenerateShot({ owner_id: "user-1", shot_id: target.id });
    await app.tick();
    const after = app.store.shotsForEpisode(episode.id);
    expect(after.filter((shot) => shot.id !== target.id).map((shot) => shot.selected_generation_id)).toEqual(
      before.filter((_, index) => complete[index]!.id !== target.id),
    );
    expect(after.find((shot) => shot.id === target.id)?.selected_generation_id).not.toBe(
      target.selected_generation_id,
    );
    expect(app.balance(series.id)).toBeGreaterThan(0);
  });

  it("rejects a spoofed OpenRouter webhook and a replayed Stripe event", async () => {
    const { app, shots, series } = await fundedSeries();
    const shot = shots.find((row) => row.shot_data.type === "dialogue")!;
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });

    await expect(
      app.handleOpenRouterWebhook({ callback_token: "not-the-token" }),
    ).rejects.toThrow("Invalid callback token");
    expect(app.getJob(job.id)?.status).toBe("generating");
    expect(app.getJob(job.id)?.upstream_job_id).toBeTruthy();
    expect(shot.selected_generation_id).toBeNull();

    await app.handleOpenRouterWebhook({ callback_token: job.callback_token });
    expect(app.getJob(job.id)?.status).toBe("completed");
    await expect(
      app.handleOpenRouterWebhook({ callback_token: job.callback_token }),
    ).rejects.toThrow("Invalid callback token");

    await expect(
      app.handleStripeWebhook({
        event_id: "evt_1",
        signature_valid: true,
        type: "checkout.session.completed",
        payment_status: "paid",
        series_id: series.id,
        owner_id: "user-1",
        amount: 25,
      }),
    ).rejects.toBeInstanceOf(DuplicateStripeEventError);

    await expect(
      app.handleStripeWebhook({
        event_id: "evt_spoof",
        signature_valid: false,
        type: "checkout.session.completed",
        payment_status: "paid",
        series_id: series.id,
        owner_id: "user-1",
        amount: 25,
      }),
    ).rejects.toThrow("Invalid Stripe signature");
  });

  it("cuts an episode from a playable take when selected_generation_id is stale", async () => {
    const { app, episode, shots } = await fundedSeries();
    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await app.tick();
    const first = app.store.shotsForEpisode(episode.id)[0]!;
    const realId = first.selected_generation_id!;
    const job = [...app.store.jobs.values()].find((row) => row.shot_id === first.id && row.job_type === "video")!;
    app.store.jobs.set(job.id, {
      ...job,
      result_metadata: { ...job.result_metadata, asset_id: "missing-take" },
    });
    app.store.shots.set(first.id, { ...first, selected_generation_id: "missing-take" });
    const rendered = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(rendered.episode.status).toBe("complete");
    expect(app.store.shots.get(first.id)?.selected_generation_id).toBe(realId);
  });

  it("keeps the existing take when ingest runs again", async () => {
    const { app, shots } = await fundedSeries();
    const shot = shots.find((row) => !row.shot_data.dialogue) ?? shots[0]!;
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    await app.tick();
    const afterFirst = app.store.shots.get(shot.id)!;
    const takeId = afterFirst.selected_generation_id!;
    const completed = app.getJob(job.id)!;
    app.store.jobs.set(completed.id, { ...completed, status: "generating" });
    await app.ingestVideoJob(app.getJob(job.id)!);
    expect(app.store.shots.get(shot.id)?.selected_generation_id).toBe(takeId);
    expect(
      (await app.assets.listBySeries(completed.series_id)).filter((asset) => asset.kind === "shot_video"),
    ).toHaveLength(1);
  });

  it("preserves heard_audio when ingest binds the take", async () => {
    const { app, shots } = await fundedSeries();
    const shot = shots.find((row) => row.shot_data.dialogue) ?? shots[0]!;
    await app.generateDialogue({ owner_id: "user-1", shot_id: shot.id });
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    await app.tick();
    const live = app.store.shots.get(shot.id)!;
    app.store.shots.set(shot.id, {
      ...live,
      shot_data: { ...live.shot_data, heard_audio: "native" },
    });
    const completed = app.getJob(job.id)!;
    app.store.jobs.set(completed.id, { ...completed, status: "generating" });
    await app.ingestVideoJob(app.getJob(job.id)!);
    expect(app.store.shots.get(shot.id)?.shot_data.heard_audio).toBe("native");
    expect(app.store.shots.get(shot.id)?.selected_generation_id).toBeTruthy();
  });

  it("redownloads a completed job when the take file is gone", async () => {
    const { app, episode, shots } = await fundedSeries();
    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await app.tick();
    const first = app.store.shotsForEpisode(episode.id)[0]!;
    const takeId = first.selected_generation_id!;
    await app.assets.delete(takeId, new Date().toISOString());
    const rendered = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(rendered.episode.status).toBe("complete");
    expect(app.store.shots.get(first.id)?.selected_generation_id).toBeTruthy();
    expect(app.store.shots.get(first.id)?.selected_generation_id).not.toBe(takeId);
  });

  it("drops a blocked take, spends one more attempt on it, and cuts with the best clean take", async () => {
    let calls = 0;
    const app = engine({
      analyze: async (input) => {
        calls += 1;
        const base: TakeAnalysis = {
          version: 2,
          duration_seconds: 5,
          has_audio: true,
          settle_in_seconds: 0.4,
          settle_hop_seconds: 0.1,
          settle_diffs: [],
          mouth_open_seconds: 1.2,
          voice_onset_seconds: 1.22,
          sync_lag_ms: 20,
          viseme_pad_seconds: 0,
          audio_slip_seconds: 0,
          internal_cut_count: 0,
          second_body: false,
          chest_skin_fraction: 0.05,
          modest_reference_fraction: 0.05,
          sheer_or_bra: false,
          face_similarity: null,
          face_count: null,
          measured_at: `t${calls}`,
        };
        // The very first dialogue take of the run grows a second body; the retry is clean.
        if (input.dialogueCu && calls === 1) return { ...base, second_body: true };
        return base;
      },
    });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_1",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    const analyzed = await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of analyzed.characters) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await app.createEpisode({ owner_id: "user-1", series_id: series.id, episode_number: 1, title: "You Knew" });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => shot.shot_data.dialogue && shot.shot_data.audio_role !== "offscreen")!;
    await app.generateDialogue({ owner_id: "user-1", shot_id: dialogue.id });
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    await app.tick();

    const first = app.getJob(job.id)!;
    expect(first.status).toBe("needs_review");
    expect(first.result_metadata.take_blockers).toContain("invented_people");
    expect(typeof first.result_metadata.auto_regenerated_job_id).toBe("string");
    const retryId = String(first.result_metadata.auto_regenerated_job_id);
    await app.tick();
    const retry = app.getJob(retryId)!;
    expect(retry.status).toBe("completed");
    expect(retry.result_metadata.take_blockers).toEqual([]);

    const shot = app.store.shots.get(dialogue.id)!;
    expect(shot.shot_data.identity_reject).toBe(false);
    expect(shot.selected_generation_id).toBe(retry.result_metadata.asset_id);

    // Force the stale (blocked) take back onto the shot; the cut must still pick the clean one.
    app.store.shots.set(dialogue.id, { ...shot, selected_generation_id: String(first.result_metadata.asset_id) });
    for (const other of planned.shots) {
      if (other.id !== dialogue.id) await app.generateVideo({ owner_id: "user-1", shot_id: other.id });
    }
    await app.tick();
    const rendered = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(rendered.episode.status).toBe("complete");
    expect(app.store.shots.get(dialogue.id)?.selected_generation_id).toBe(retry.result_metadata.asset_id);
    const manifestShot = rendered.episode.render_manifest?.shots.find((row) => row.shot_id === dialogue.id);
    expect(manifestShot?.in_point_seconds).toBe(0.4);
  });

  it("refuses to ship an episode around an identity_reject take unless the caller allows a partial cut", async () => {
    const { app, episode, shots } = await fundedSeries();
    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await app.tick();
    const stranger = app.store.shotsForEpisode(episode.id)[0]!;
    app.store.shots.set(stranger.id, {
      ...stranger,
      shot_data: { ...stranger.shot_data, identity_reject: true },
      selected_generation_id: null,
    });
    await expect(app.renderEpisode({ owner_id: "user-1", episode_id: episode.id })).rejects.toBeInstanceOf(
      RenderIncompleteError,
    );
    expect(app.store.episodes.get(episode.id)?.status).not.toBe("complete");

    const rendered = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id, allow_partial: true });
    expect(rendered.episode.status).toBe("complete");
    expect(rendered.episode.render_manifest?.shots.some((row) => row.shot_id === stranger.id)).toBe(false);
  });

  it("refuses the final when the mux audit fails, and keeps the audit for review", async () => {
    const refusing = engine({
      audit: async (input) => ({
        ...(await passingAudit(input)),
        ship: false,
        reasons: ["sync:shot-x", "room_morph:shot-x"],
      }),
    });
    const series = await refusing.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await refusing.handleStripeWebhook({
      event_id: "evt_1",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    const analyzed = await refusing.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of analyzed.characters) {
      await refusing.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await refusing.createEpisode({ owner_id: "user-1", series_id: series.id, episode_number: 1, title: "x" });
    const planned = await refusing.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    for (const shot of planned.shots) {
      await refusing.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await refusing.tick();
    await expect(refusing.renderEpisode({ owner_id: "user-1", episode_id: episode.id })).rejects.toThrow(/mux audit refused/);
    expect(refusing.store.episodes.get(episode.id)?.status).toBe("needs_review");
    const kinds = (await refusing.assets.listBySeries(series.id)).map((asset) => asset.kind);
    expect(kinds).toContain("episode_audit");
    expect(kinds).not.toContain("episode_final");
  });

  it("never marks an episode complete when the mixer fails", async () => {
    const failing = createEngine({
      dailyCap: 1000,
      ai: testGateway(),
      assets: new MemoryAssetStore(),
      audit: passingAudit,
      render: async () => {
        throw new RenderFailedError("ffmpeg exploded");
      },
    });
    const series = await failing.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await failing.handleStripeWebhook({
      event_id: "evt_1",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    const analyzed = await failing.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of analyzed.characters) {
      await failing.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await failing.createEpisode({ owner_id: "user-1", series_id: series.id, episode_number: 1, title: "x" });
    const planned = await failing.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    for (const shot of planned.shots) {
      await failing.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await failing.tick();
    await expect(failing.renderEpisode({ owner_id: "user-1", episode_id: episode.id })).rejects.toBeInstanceOf(
      RenderFailedError,
    );
    expect(failing.store.episodes.get(episode.id)?.status).not.toBe("complete");
    expect((await failing.assets.listBySeries(series.id)).some((asset) => asset.kind === "episode_final")).toBe(false);
  });

  it("cuts an episode from needs_review takes", async () => {
    const { app, episode, shots } = await fundedSeries();
    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await app.tick();
    const first = app.store.shotsForEpisode(episode.id)[0]!;
    app.store.shots.set(first.id, { ...first, status: "needs_review" });
    const rendered = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(rendered.episode.status).toBe("complete");
    expect(app.store.shots.get(first.id)?.status).toBe("complete");
    expect(app.store.shots.get(first.id)?.selected_generation_id).toBeTruthy();
  });

  it("submits video immediately and reuses the active job for the same shot", async () => {
    const { app, shots } = await fundedSeries();
    const shot = shots.find((row) => !row.shot_data.dialogue) ?? shots[0]!;
    const first = await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    expect(first.job.status).toBe("generating");
    expect(first.job.upstream_job_id).toBeTruthy();
    const reserved = app.store.ledger.filter((row) => row.entry_type === "reserve" && row.generation_job_id === first.job.id);
    const second = await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    expect(second.job.id).toBe(first.job.id);
    expect(
      app.store.ledger.filter((row) => row.entry_type === "reserve" && row.generation_job_id === first.job.id),
    ).toHaveLength(reserved.length);
    expect(
      [...app.store.jobs.values()].filter((job) => job.shot_id === shot.id && job.job_type === "video"),
    ).toHaveLength(1);
  });

  it("sends a face still first on dialogue and an object plate on inserts", async () => {
    const submits: Array<{ urls: string[]; silent: boolean }> = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    let privacyOnce = true;
    ai.video.submit = async (request) => {
      submits.push({
        urls: request.visual_reference_urls,
        silent: !request.shot.shot_data.dialogue,
      });
      if (privacyOnce && request.visual_reference_urls.length > 1) {
        privacyOnce = false;
        throw new Error(
          'OpenRouter /videos failed HTTP 400: InputImageSensitiveContentDetected.PrivacyInformation input image content[1] may contain real person',
        );
      }
      return inner(request);
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore() });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_location",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    await app.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const insert = planned.shots.find((shot) => shot.shot_data.function === "insert_evidence")!;
    const dialogue = planned.shots.find((shot) => shot.shot_data.audio_role === "onscreen" && shot.shot_data.dialogue)!;
    await app.generateVideo({ owner_id: "user-1", shot_id: insert.id });
    await app.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    const insertSubmit = submits.find((row) => row.silent)!;
    const dialogueAttempts = submits.filter((row) => !row.silent);
    expect(insertSubmit.urls).toHaveLength(1);
    expect(insertSubmit.urls[0]).toContain("memory://");
    expect(dialogueAttempts[0]?.urls.length).toBeGreaterThan(0);
    const insertJob = [...app.store.jobs.values()].find((job) => job.shot_id === insert.id && job.job_type === "video")!;
    const dialogueJob = [...app.store.jobs.values()].find((job) => job.shot_id === dialogue.id && job.job_type === "video")!;
    expect(String(insertJob.request_metadata.prompt)).toMatch(/NO people|OBJECT INSERT/i);
    expect(String(dialogueJob.request_metadata.prompt)).toMatch(/ONE face|TIGHT CLOSE-UP SINGLE/i);
    expect(String(dialogueJob.request_metadata.prompt)).toMatch(/Same person as reference image 1/);
    expect(String(dialogueJob.request_metadata.prompt)).not.toMatch(/only 2 people/i);
    expect(insertJob.request_metadata.first_frame_kind).toBe("object");
    expect(["cu", "face"]).toContain(dialogueJob.request_metadata.first_frame_kind);
    expect(app.store.shots.get(insert.id)?.shot_data.insert_plate_id).toBeTruthy();
    expect(app.store.shots.get(insert.id)?.shot_data.insert_plate_id).not.toBe(
      app.store.shots.get(insert.id)?.shot_data.look_id,
    );
  });

  it("sends only the location plate on an empty establishing — never a face", async () => {
    const submits: Array<{ urls: string[]; prompt: string }> = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    ai.video.submit = async (request) => {
      submits.push({ urls: request.visual_reference_urls, prompt: request.prompt });
      return inner(request);
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore() });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_empty_room",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    await app.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const wide = planned.shots.find(
      (shot) =>
        (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") &&
        !shot.shot_data.dialogue,
    );
    if (!wide) return;
    await app.generateVideo({ owner_id: "user-1", shot_id: wide.id });
    const job = [...app.store.jobs.values()].find((row) => row.shot_id === wide.id && row.job_type === "video");
    expect(job).toBeTruthy();
    expect(String(job!.request_metadata.prompt)).toMatch(/EMPTY ROOM|NO people/i);
    expect(["wardrobe", "object"]).toContain(job!.request_metadata.first_frame_kind);
    expect(job!.request_metadata.first_frame_kind).not.toBe("face");
    expect(job!.request_metadata.first_frame_kind).not.toBe("cu");
    const sent = submits.at(-1);
    expect(sent?.urls.length).toBeLessThanOrEqual(1);
  });

  it("derives a CU first_frame from a full-body still instead of sending the plate", async () => {
    const kinds: string[] = [];
    const ai = testGateway();
    const image = ai.image;
    ai.image = {
      ...image,
      async generateReferenceFromSeed(input) {
        kinds.push(input.kind);
        return image.generateReferenceFromSeed(input);
      },
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore() });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_cu_from_body",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
      const ready = app.store.characters.get(character.id)!;
      const body = ready.visual_reference_asset_ids.front ?? ready.visual_reference_asset_ids.full_body;
      const bodyRefs = body ? { full_body: body } : {};
      app.store.characters.set(character.id, {
        ...ready,
        visual_reference_asset_ids: bodyRefs,
      });
      if (ready.actor_id) {
        const actor = app.store.actors.get(ready.actor_id);
        if (actor) {
          app.store.actors.set(actor.id, { ...actor, visual_reference_asset_ids: bodyRefs });
        }
      }
    }
    await app.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => shot.shot_data.audio_role === "onscreen" && shot.shot_data.dialogue)!;
    await app.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    const job = [...app.store.jobs.values()].find((row) => row.shot_id === dialogue.id && row.job_type === "video")!;
    expect(job.request_metadata.first_frame_kind).toBe("cu");
    expect(kinds).toContain("cu");
    expect(app.store.charactersFor(series.id).some((row) => row.visual_reference_asset_ids.cu)).toBe(true);
  });

  it("retries a rejected location still with no reference images", async () => {
    const submits: string[][] = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    ai.video.submit = async (request) => {
      submits.push(request.visual_reference_urls);
      if (request.visual_reference_urls.length > 0) {
        throw new Error(
          "InputImageSensitiveContentDetected.PrivacyInformation input image content[1] may contain real person",
        );
      }
      return inner(request);
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore() });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Forbidden Billionaire",
      description: "A fictional couple argues in a penthouse kitchen after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_location_empty",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    await app.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const silent = planned.shots.find((shot) => !shot.shot_data.dialogue)!;
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: silent.id });
    expect(job.status).toBe("generating");
    expect(job.upstream_job_id).toBeTruthy();
    expect(submits[0]?.length).toBeGreaterThan(0);
    expect(submits.at(-1)).toEqual([]);
  });

  it("blocks generation when the project is out of budget", async () => {
    const app = engine();
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Broke",
      description: "A fictional argument with no money behind it.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_broke",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 0.02,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    const character = app.store.charactersFor(series.id)[0]!;
    await expect(
      app.lockCharacter({ owner_id: "user-1", character_id: character.id }),
    ).rejects.toThrow(/Insufficient project budget/);
  });

  it("reuses a designed voice preview instead of billing Voice Design again", async () => {
    let designs = 0;
    const ai = testGateway();
    const speech = ai.speech;
    ai.speech = {
      ...speech,
      async designVoice(description) {
        designs += 1;
        return speech.designVoice(description);
      },
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore() });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Voice reuse",
      description: "A fictional kitchen argument after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_voice",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    const analyzed = await app.analyze({ owner_id: "user-1", series_id: series.id });
    const character = analyzed.characters[0]!;
    const designed = await app.designVoice({ owner_id: "user-1", character_id: character.id });
    expect(designs).toBe(1);
    await app.lockCharacter({
      owner_id: "user-1",
      character_id: character.id,
      voice_candidate_id: designed.candidates[0]!.preview_id,
    });
    expect(designs).toBe(1);
    expect(app.store.characters.get(character.id)?.voice_profile.elevenlabs_voice_id).toMatch(
      /^el_saved_/,
    );
    let images = 0;
    const image = ai.image;
    ai.image = {
      ...image,
      async generateReference(input) {
        images += 1;
        return image.generateReference(input);
      },
    };
    await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    expect(images).toBe(0);
  });

  async function analyzedVoiceApp(ai = testGateway(), assets = new MemoryAssetStore()) {
    const app = createEngine({ dailyCap: 1000, ai, assets });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Voice restore",
      description: "A fictional kitchen argument after a three-month lie.",
    });
    await app.handleStripeWebhook({
      event_id: `evt_${series.id}`,
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    const analyzed = await app.analyze({ owner_id: "user-1", series_id: series.id });
    return { app, series, character: analyzed.characters[0]!, ai, assets };
  }

  it("restores pending previews from a completed job and locks without designing again", async () => {
    let designs = 0;
    const ai = testGateway();
    const speech = ai.speech;
    ai.speech = {
      ...speech,
      async designVoice(description) {
        designs += 1;
        return speech.designVoice(description);
      },
    };
    const first = await analyzedVoiceApp(ai);
    await first.app.designVoice({ owner_id: "user-1", character_id: first.character.id });
    expect(designs).toBe(1);
    const emptied = first.app.store.characters.get(first.character.id)!;
    first.app.store.characters.set(first.character.id, {
      ...emptied,
      voice_profile: { ...emptied.voice_profile, pending_previews: [] },
    });
    const second = createEngine({ dailyCap: 1000, ai, assets: first.assets, store: first.app.store });
    await second.lockCharacter({ owner_id: "user-1", character_id: first.character.id });
    expect(designs).toBe(1);
    const locked = second.store.characters.get(first.character.id)!;
    expect(locked.locked).toBe(true);
    expect(locked.voice_profile.elevenlabs_voice_id).toBeTruthy();
    expect(locked.voice_profile.canonical_reference_asset_id).toBeTruthy();
  });

  it("locks from an existing voice reference without saving a new voice", async () => {
    let saves = 0;
    const ai = testGateway();
    const speech = ai.speech;
    ai.speech = {
      ...speech,
      async saveVoice(candidate) {
        saves += 1;
        return speech.saveVoice(candidate);
      },
    };
    const { app, character, assets } = await analyzedVoiceApp(ai);
    await assets.put({
      id: "voice-ref-existing",
      owner_id: "user-1",
      series_id: character.series_id,
      kind: "voice_reference",
      bucket: "private-character",
      storage_path: "private-character/voice-ref-existing.mp3",
      mime_type: "audio/mpeg",
      body: new Uint8Array([9, 8, 7]),
      checksum: "ref",
      metadata: { character_id: character.id, elevenlabs_voice_id: "el_already_saved" },
      created_at: "2026-08-30T00:00:00.000Z",
    });
    const locked = await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    expect(saves).toBe(0);
    expect(locked.voice_profile.elevenlabs_voice_id).toBe("el_already_saved");
    expect(locked.voice_profile.canonical_reference_asset_id).toBe("voice-ref-existing");
    expect(locked.locked).toBe(true);
  });

  it("redesigns once when the generated voice id has expired", async () => {
    let designs = 0;
    let saves = 0;
    const ai = testGateway();
    const speech = ai.speech;
    ai.speech = {
      ...speech,
      async designVoice(description) {
        designs += 1;
        return speech.designVoice(description);
      },
      async saveVoice(candidate) {
        saves += 1;
        if (saves === 1) {
          throw new Error("ElevenLabs /v1/text-to-voice failed HTTP 400: generated_voice_id expired");
        }
        return speech.saveVoice(candidate);
      },
    };
    const { app, character } = await analyzedVoiceApp(ai);
    await app.designVoice({ owner_id: "user-1", character_id: character.id });
    expect(designs).toBe(1);
    await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    expect(designs).toBe(2);
    expect(saves).toBe(2);
    expect(app.store.characters.get(character.id)?.locked).toBe(true);
    const keys = [...app.store.jobs.values()].map((job) => job.idempotency_key);
    expect(keys.some((key) => key.endsWith(":redesign-1"))).toBe(true);
    expect(keys.filter((key) => key.includes("redesign-2"))).toHaveLength(0);
  });

  it("surfaces a media GET failure instead of pretending there is no candidate", async () => {
    const assets = new MemoryAssetStore();
    const { app, character } = await analyzedVoiceApp(undefined, assets);
    await app.designVoice({ owner_id: "user-1", character_id: character.id });
    const originalGet = assets.get.bind(assets);
    assets.get = async (id: string) => {
      const row = await originalGet(id);
      if (row?.asset.kind === "voice_preview") throw new Error("Media store GET failed HTTP 403");
      return row;
    };
    const second = createEngine({ dailyCap: 1000, ai: testGateway(), assets, store: app.store });
    await expect(second.lockCharacter({ owner_id: "user-1", character_id: character.id })).rejects.toThrow(
      /Media store GET failed HTTP 403 for voice_preview/,
    );
  });

  it("plans from the stored story bible instead of analyzing again", async () => {
    const { app, series, episode } = await fundedSeries();
    expect(app.store.series.get(series.id)?.story_bible?.title).toBe("Forbidden Billionaire");
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    expect(planned.shots.length).toBeGreaterThan(0);
    const draft = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 2,
      title: "No bible",
    });
    app.store.series.set(series.id, { ...app.store.series.get(series.id)!, story_bible: null });
    await expect(app.planEpisode({ owner_id: "user-1", episode_id: draft.id })).rejects.toThrow(
      /no stored story bible/,
    );
  });

  it("re-renders the same bytes from a stored manifest", async () => {
    const { app, episode, shots } = await fundedSeries();
    for (const shot of shots) {
      await app.generateVideo({ owner_id: "user-1", shot_id: shot.id });
    }
    await app.tick();
    const first = await app.renderEpisode({ owner_id: "user-1", episode_id: episode.id });
    const shotBodies = [];
    const alignments: Array<AlignmentTrack | null> = [];
    const storeShots = app.store.shotsForEpisode(episode.id);
    for (const item of first.episode.render_manifest!.shots) {
      shotBodies.push((await app.assets.get(item.asset_id))!.body);
      const shot = storeShots.find((row) => row.id === item.shot_id);
      const captionId = shot?.shot_data.dialogue_alignment_asset_id;
      alignments.push(captionId ? decodeJson((await app.assets.get(captionId))!.body) : null);
    }
    const again = await fakeRender({
      manifest: first.episode.render_manifest!,
      shotBodies,
      alignments,
    });
    expect(again.checksum).toBe(first.checksum);
  });

  it("fails closed when the real mixer is handed undecodable takes", async () => {
    await expect(
      renderEpisodeBytes({
        manifest: {
          version: 1,
          episode_id: "e",
          shots: [{ shot_id: "s", asset_id: "a", in_point_seconds: 0, out_point_seconds: 2 }],
          caption_asset_ids: [],
          music_asset_ids: [],
          sfx_asset_ids: [],
          transitions: [],
        },
        shotBodies: [new Uint8Array([1, 2, 3])],
        alignments: [],
      }),
    ).rejects.toBeInstanceOf(RenderFailedError);
  });

  it("recovers a stuck job through the reconciliation sweeper", async () => {
    let now = Date.parse("2026-08-30T00:00:00.000Z");
    const app = createEngine({
      dailyCap: 1000,
      ai: testGateway(),
      assets: new MemoryAssetStore(),
      clock: { now: () => new Date(now) },
    });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Stuck",
      description: "A fictional kitchen argument that times out.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_stuck",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "Hang",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const { job } = await app.generateVideo({
      owner_id: "user-1",
      shot_id: planned.shots[0]!.id,
    });
    expect(app.getJob(job.id)?.status).toBe("generating");
    expect(app.getJob(job.id)?.upstream_job_id).toBeTruthy();
    now += 10 * 60 * 1000;
    const recovered = await app.reconcile();
    expect(recovered[0]?.status).toBe("completed");
  });

  it("keeps polling a video job that is still generating", async () => {
    let now = Date.parse("2026-08-30T00:00:00.000Z");
    let polls = 0;
    let requested = 4;
    const ai = testGateway();
    ai.video = {
      async submit(request) {
        const offscreen =
          request.shot.shot_data.audio_role === "offscreen" ||
          request.shot.shot_data.function === "listener_hold" ||
          request.shot.shot_data.audio_role === "silent";
        if (request.shot.shot_data.dialogue && !request.audio_reference_url && !offscreen) {
          throw new Error("Dialogue video requires a real dialogue-audio URL");
        }
        requested = request.duration_seconds ?? 4;
        return { upstream_job_id: "orv_slow", provider: "openrouter", model: request.model };
      },
      async getStatus() {
        polls += 1;
        return {
          upstream_job_id: "orv_slow",
          status: polls < 3 ? "pending" : "completed",
          output_url: null,
          actual_cost: 0.12,
          error: null,
        };
      },
      async download() {
        return { bytes: buildPortraitMp4(requested), mime_type: "video/mp4" };
      },
    };
    const app = createEngine({
      dailyCap: 1000,
      ai,
      assets: new MemoryAssetStore(),
      clock: { now: () => new Date(now) },
    });
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Poll",
      description: "A fictional kitchen argument that takes more than one tick.",
    });
    await app.handleStripeWebhook({
      event_id: "evt_poll",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "Slow",
    });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const { job } = await app.generateVideo({
      owner_id: "user-1",
      shot_id: planned.shots[0]!.id,
    });
    await app.tick();
    expect(app.getJob(job.id)?.status).toBe("generating");
    now += 16_000;
    await app.tick();
    expect(app.getJob(job.id)?.status).toBe("generating");
    now += 16_000;
    await app.tick();
    expect(app.getJob(job.id)?.status).toBe("completed");
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it("fails a video job that stays pending past the max age and releases its reserve", async () => {
    let now = Date.parse("2026-08-30T00:00:00.000Z");
    const ai = testGateway();
    ai.video = {
      async submit(request) {
        return { upstream_job_id: "orv_lost", provider: "openrouter", model: request.model };
      },
      async getStatus() {
        return { upstream_job_id: "orv_lost", status: "pending", output_url: null, actual_cost: null, error: null };
      },
      async download() {
        throw new Error("never ready");
      },
    };
    const app = createEngine({ dailyCap: 1000, ai, assets: new MemoryAssetStore(), clock: { now: () => new Date(now) } });
    const series = await app.createSeries({ owner_id: "user-1", title: "Lost", description: "A fictional kitchen argument the provider forgets." });
    await app.handleStripeWebhook({
      event_id: "evt_lost",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 25,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    for (const character of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: character.id });
    }
    const episode = await app.createEpisode({ owner_id: "user-1", series_id: series.id, episode_number: 1, title: "Lost" });
    const planned = await app.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const silent = planned.shots.find((shot) => !shot.shot_data.dialogue) ?? planned.shots[0]!;
    const before = app.balance(series.id);
    const { job } = await app.generateVideo({ owner_id: "user-1", shot_id: silent.id });
    expect(app.balance(series.id)).toBeLessThan(before);
    now += 10 * 60 * 1000;
    await app.tick();
    expect(app.getJob(job.id)?.status).toBe("generating");
    now += 40 * 60 * 1000;
    await app.tick();
    expect(app.getJob(job.id)?.status).toBe("failed");
    expect(app.getJob(job.id)?.error_code).toBe("pending_timeout");
    expect(app.balance(series.id)).toBe(before);
  });

  it("exposes a series estimate and refuses to plan before the cast is locked", async () => {
    const app = engine();
    const series = await app.createSeries({
      owner_id: "user-1",
      title: "Estimate",
      description: "A fictional kitchen argument.",
      target_episode_count: 12,
      sku: 12,
    });
    const estimate = app.estimateSeries(12);
    expect(estimate.retail).toBe(433);
    expect(estimate.estimated_max).toBeLessThan(estimate.retail);
    await app.handleStripeWebhook({
      event_id: "evt_estimate",
      signature_valid: true,
      type: "checkout.session.completed",
      payment_status: "paid",
      series_id: series.id,
      owner_id: "user-1",
      amount: 433,
    });
    await app.analyze({ owner_id: "user-1", series_id: series.id });
    const episode = await app.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "Unlocked",
    });
    await expect(app.planEpisode({ owner_id: "user-1", episode_id: episode.id })).rejects.toThrow(
      /Lock every character/,
    );
  });

  it("debits unused budget on a Stripe refund and never goes below zero", async () => {
    const { app, series } = await fundedSeries();
    const before = app.balance(series.id);
    await app.handleStripeWebhook({
      event_id: "re_1",
      signature_valid: true,
      type: "charge.refunded",
      series_id: series.id,
      owner_id: "user-1",
      amount: before + 40,
    });
    expect(app.balance(series.id)).toBe(0);
  });

  it("creates an actor from appearance and restores the pack by idempotency key", async () => {
    const { app, character } = await analyzedVoiceApp();
    const first = await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    expect(first.actor_id).toBeTruthy();
    expect(first.visual_reference_asset_ids.front).toBeTruthy();
    const actor = app.store.actors.get(first.actor_id!)!;
    expect(actor.visual_reference_asset_ids.front).toBe(first.visual_reference_asset_ids.front);
    app.store.characters.set(character.id, { ...first, visual_reference_asset_ids: {} });
    const restored = await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    expect(restored.visual_reference_asset_ids.front).toBe(first.visual_reference_asset_ids.front);
    expect([...app.store.jobs.values()].filter((job) => job.idempotency_key === `appearance:${character.id}`)).toHaveLength(1);
  });

  it("attaches the same actor to two series and keeps the face if one series is deleted", async () => {
    const first = await analyzedVoiceApp();
    const packed = await first.app.generateAppearance({ owner_id: "user-1", character_id: first.character.id });
    const actorId = packed.actor_id!;
    const second = await analyzedVoiceApp();
    second.app.store.actors.set(actorId, first.app.store.actors.get(actorId)!);
    const attached = await second.app.attachActor({
      owner_id: "user-1",
      character_id: second.character.id,
      actor_id: actorId,
    });
    expect(attached.actor_id).toBe(actorId);
    expect(attached.visual_reference_asset_ids.front).toBe(packed.visual_reference_asset_ids.front);
    first.app.store.series.set(first.series.id, {
      ...first.app.store.series.get(first.series.id)!,
      deleted_at: new Date().toISOString(),
    });
    expect(second.app.store.actors.get(actorId)?.visual_reference_asset_ids.front).toBe(
      packed.visual_reference_asset_ids.front,
    );
  });

  it("picks face plus the matching wardrobe look for a dialogue shot", async () => {
    const submits: string[][] = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    ai.video.submit = async (request) => {
      submits.push(request.visual_reference_urls);
      return inner(request);
    };
    const { app, series, character } = await analyzedVoiceApp(ai);
    await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    await app.generateWardrobe({ owner_id: "user-1", character_id: character.id });
    for (const row of app.store.charactersFor(series.id)) {
      if (row.id !== character.id) await app.lockCharacter({ owner_id: "user-1", character_id: row.id });
      else await app.lockCharacter({ owner_id: "user-1", character_id: row.id });
    }
    const faceFirst = createEngine({
      dailyCap: 1000,
      ai,
      assets: app.assets,
      store: app.store,
      identityRefPolicy: "face_first",
    });
    await faceFirst.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await faceFirst.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await faceFirst.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => Boolean(shot.shot_data.dialogue))!;
    const ready = faceFirst.store.characters.get(character.id)!;
    expect(ready.wardrobe_asset_ids.home ?? ready.wardrobe_asset_ids.everyday).toBeTruthy();
    await faceFirst.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    expect(submits[0]!.length).toBeGreaterThanOrEqual(2);
  });

  it("puts wardrobe first when identity policy is wardrobe_first", async () => {
    const submits: string[][] = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    ai.video.submit = async (request) => {
      submits.push(request.visual_reference_urls);
      return inner(request);
    };
    const { app, series, character } = await analyzedVoiceApp(ai);
    await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    await app.generateWardrobe({ owner_id: "user-1", character_id: character.id });
    for (const row of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: row.id });
    }
    const wardrobeFirst = createEngine({
      dailyCap: 1000,
      ai,
      assets: app.assets,
      store: app.store,
      identityRefPolicy: "wardrobe_first",
    });
    await wardrobeFirst.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await wardrobeFirst.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await wardrobeFirst.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => Boolean(shot.shot_data.dialogue))!;
    await wardrobeFirst.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    expect(submits.at(-1)!.length).toBeGreaterThanOrEqual(2);
    const job = [...wardrobeFirst.store.jobs.values()].find(
      (row) => row.shot_id === dialogue.id && row.job_type === "video",
    )!;
    expect(job.request_metadata.identity_ref_policy).toBe("wardrobe_first");
    expect(["wardrobe", "full_body", "face", "cu"]).toContain(job.request_metadata.first_frame_kind);
  });

  it("sends only the face CU when identity policy is face_only", async () => {
    const submits: string[][] = [];
    const ai = testGateway();
    const inner = ai.video.submit;
    ai.video.submit = async (request) => {
      submits.push(request.visual_reference_urls);
      return inner(request);
    };
    const { app, series, character } = await analyzedVoiceApp(ai);
    await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    await app.generateWardrobe({ owner_id: "user-1", character_id: character.id });
    for (const row of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: row.id });
    }
    const faceOnly = createEngine({
      dailyCap: 1000,
      ai,
      assets: app.assets,
      store: app.store,
      identityRefPolicy: "face_only",
    });
    await faceOnly.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await faceOnly.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await faceOnly.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => Boolean(shot.shot_data.dialogue))!;
    await faceOnly.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    expect(submits.at(-1)).toHaveLength(1);
    const job = [...faceOnly.store.jobs.values()].find(
      (row) => row.shot_id === dialogue.id && row.job_type === "video",
    )!;
    expect(job.request_metadata.identity_ref_policy).toBe("face_only");
    expect(job.request_metadata.extra_ref_count).toBe(0);
  });

  it("keeps a locked CU still when crop_version is stale", async () => {
    const ai = testGateway();
    const { app, series, character, assets } = await analyzedVoiceApp(ai);
    await app.generateAppearance({ owner_id: "user-1", character_id: character.id });
    for (const row of app.store.charactersFor(series.id)) {
      await app.lockCharacter({ owner_id: "user-1", character_id: row.id });
    }
    const stale = await assets.put({
      id: "stale-locked-cu",
      owner_id: "user-1",
      series_id: series.id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: "stale-cu.png",
      mime_type: "image/png",
      body: new Uint8Array(80).fill(9),
      checksum: "stale-locked-cu",
      metadata: { kind: "cu", crop_version: 1 },
      created_at: new Date().toISOString(),
    });
    const live = app.store.characters.get(character.id)!;
    app.store.characters.set(character.id, {
      ...live,
      visual_reference_asset_ids: { ...live.visual_reference_asset_ids, cu: stale.id },
    });
    const faceOnly = createEngine({
      dailyCap: 1000,
      ai,
      assets,
      store: app.store,
      identityRefPolicy: "face_only",
    });
    await faceOnly.lockLocations({ owner_id: "user-1", series_id: series.id });
    const episode = await faceOnly.createEpisode({
      owner_id: "user-1",
      series_id: series.id,
      episode_number: 1,
      title: "You Knew",
    });
    const planned = await faceOnly.planEpisode({ owner_id: "user-1", episode_id: episode.id });
    const dialogue = planned.shots.find((shot) => Boolean(shot.shot_data.dialogue))!;
    await faceOnly.generateDialogue({ owner_id: "user-1", shot_id: dialogue.id }).catch(() => undefined);
    await faceOnly.generateVideo({ owner_id: "user-1", shot_id: dialogue.id });
    const job = [...faceOnly.store.jobs.values()].find(
      (row) => row.shot_id === dialogue.id && row.job_type === "video",
    )!;
    expect(job.request_metadata.first_frame_asset_id).toBe(stale.id);
    expect(job.request_metadata.extra_ref_count).toBe(0);
  });

  it("lets an admin skip series budget while still writing ledger rows", async () => {
    const app = createEngine({
      dailyCap: 1000,
      skipSeriesBudget: true,
      ai: testGateway(),
      assets: new MemoryAssetStore(),
    });
    const series = await app.createSeries({
      owner_id: "admin-1",
      title: "Admin",
      description: "A fictional kitchen argument with no prepaid pack.",
    });
    const analyzed = await app.analyze({ owner_id: "admin-1", series_id: series.id });
    expect(analyzed.job.status).toBe("completed");
    expect(app.balance(series.id)).toBeLessThan(0);
  });
});
