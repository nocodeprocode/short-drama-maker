/**
 * Lock v9, reproduced by the engine.
 *
 * The original v9 script muxed two hand-picked Wan takes with hand-tuned
 * constants (Mara settle 3.0s, mouth 3.4s, Eli head trim 0.3s) and a bespoke
 * frame audit. This version feeds the same two takes through the product
 * modules: `analyzeTake` measures what the constants used to encode,
 * `pictureInPointFor` turns the settle into the manifest in-point,
 * `renderEpisodeBytes` mixes, and `auditMux` decides whether it ships.
 * Zero API spend. Prior watch files are never overwritten.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { RenderManifest, Shot } from "../src/engine/domain.ts";
import { pictureInPointFor } from "../src/drama-engine/editorial/manifest-builder.ts";
import { auditMux } from "../src/engine/media/mux-audit.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { analyzeTake, scoreTake, type TakeAnalysis } from "../src/engine/pipeline/take-analysis.ts";
import { libraryReady } from "../src/drama-engine/index.ts";

const ROOT = resolve(process.cwd(), "assets");
const SRC = resolve(ROOT, "lock-v5-tmp");
const OUT = resolve(ROOT, "drama-lock-v9-engine.mp4");
const FAIL_OUT = resolve(ROOT, "drama-lock-v9-engine-audit-fail.mp4");
const AUDIT = resolve(ROOT, "drama-lock-v9-engine-audit.json");
const PRIOR_SPEND = 61.81;

type Take = { id: string; speaker: string; line: string; file: string; still: string | null };

const TAKES: Take[] = [
  {
    id: "mara",
    speaker: "MARA",
    line: "Eli, look at Tuesday.",
    file: resolve(SRC, "mara-try1.mp4"),
    still: resolve(ROOT, "drama-id-cu-mara-voss-modest.png"),
  },
  {
    id: "eli",
    speaker: "ELI",
    line: "I did not write the paper.",
    file: resolve(SRC, "eli-try2.mp4"),
    still: null,
  },
];

function shotFor(take: Take, analysis: TakeAnalysis, position: number): Shot {
  return {
    id: take.id,
    scene_id: "lock",
    position,
    status: "complete",
    selected_generation_id: take.id,
    shot_data: {
      type: "dialogue",
      speaker: take.speaker,
      dialogue: take.line,
      emotion: null,
      camera: "tight single",
      duration_hint_seconds: analysis.duration_seconds,
      duration_seconds: analysis.duration_seconds,
      audio_role: "onscreen",
      heard_audio: "native",
      function: position === 0 ? "hook_cu" : "accusation_cu",
      edit_mode: "locked_take",
      take_analysis: analysis,
    },
    created_at: "lock",
    updated_at: "lock",
  } as unknown as Shot;
}

function vttTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `00:${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

async function main() {
  if (!libraryReady()) throw new Error("music library missing");
  await mkdir(ROOT, { recursive: true });

  const bodies: Uint8Array[] = [];
  const analyses: TakeAnalysis[] = [];
  for (const take of TAKES) {
    const video = new Uint8Array(await readFile(take.file));
    const still = take.still ? new Uint8Array(await readFile(take.still)) : null;
    const analysis = await analyzeTake({ video, still, modestStill: still, dialogueCu: true, wanDialogue: true });
    const verdict = scoreTake(analysis, { dialogueCu: true, lockedTake: true, expectedFaces: 1 });
    process.stdout.write(
      `  ${take.id}: settle=${analysis.settle_in_seconds}s mouth=${analysis.mouth_open_seconds} voice=${analysis.voice_onset_seconds} lag=${analysis.sync_lag_ms}ms pad=${analysis.viseme_pad_seconds}s slip=${analysis.audio_slip_seconds}s cuts=${analysis.internal_cut_count} sheer=${analysis.sheer_or_bra} score=${verdict.score} blockers=${verdict.blockers.join(",") || "none"}\n`,
    );
    if (verdict.blockers.length) throw new Error(`${take.id} take is not shippable: ${verdict.blockers.join(", ")}`);
    bodies.push(video);
    analyses.push(analysis);
  }

  const shots = TAKES.map((take, index) => shotFor(take, analyses[index]!, index));
  let clock = 0;
  const manifestShots: RenderManifest["shots"] = shots.map((shot, index) => {
    const analysis = analyses[index]!;
    const inPoint = pictureInPointFor(shot);
    const outPoint = Math.min(inPoint + 5.5, analysis.duration_seconds);
    const row: RenderManifest["shots"][number] = {
      shot_id: shot.id,
      asset_id: shot.id,
      in_point_seconds: inPoint,
      out_point_seconds: outPoint,
      picture_start_seconds: clock,
      audio_start_seconds: clock,
      hold_tail_seconds: 0,
      audio_slip_seconds: analysis.audio_slip_seconds,
      scene_kind: "dialogue",
      transition_in: "cut",
      audio_role: "onscreen",
      heard_audio: "native",
      speaker: shot.shot_data.speaker,
    };
    clock += outPoint - inPoint - analysis.audio_slip_seconds;
    return row;
  });
  const manifest: RenderManifest = {
    version: 1,
    episode_id: "lock-v9-engine",
    shots: manifestShots,
    caption_asset_ids: [],
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: [],
    scenes: [{ index: 0, kind: "dialogue", shot_ids: shots.map((shot) => shot.id) }],
  };

  // Captions from the measured voice onset, so the name plate lands with the line.
  const cues = manifestShots.map((row, index) => {
    const analysis = analyses[index]!;
    const start =
      (row.picture_start_seconds ?? 0) +
      Math.max(0, (analysis.voice_onset_seconds ?? row.in_point_seconds) - row.in_point_seconds) +
      analysis.viseme_pad_seconds -
      analysis.audio_slip_seconds;
    return `${index + 1}\n${vttTime(start)} --> ${vttTime(start + 3)}\n${TAKES[index]!.speaker}: ${TAKES[index]!.line}\n`;
  });
  const heardLanes = TAKES.map(() => "native" as const);

  const rendered = await renderEpisodeBytes({
    manifest,
    shotBodies: bodies,
    alignments: [],
    heardLanes,
    visemePadSeconds: analyses.map((row) => row.viseme_pad_seconds),
    visemeMouthOpenSeconds: analyses.map((row) => row.mouth_open_seconds),
    visemeVoiceOnsetSeconds: analyses.map((row) => row.voice_onset_seconds),
    vtt: ["WEBVTT", "", ...cues].join("\n"),
  });

  const audit = await auditMux({ body: rendered.body, dialogueStem: rendered.dialogueStem ?? null, manifest, analyses, heardLanes });
  const sha256 = createHash("sha256").update(rendered.body).digest("hex");
  const report = {
    ...audit,
    path: audit.ship ? OUT : FAIL_OUT,
    watch_file: audit.ship ? OUT : null,
    do_not_overwrite: ["assets/drama-lock-v9.mp4", "assets/drama-lock-v8.mp4", "assets/drama-lock-v7.mp4"],
    sha256,
    takes: TAKES.map((take, index) => ({ id: take.id, file: take.file, analysis: analyses[index] })),
    manifest,
    spend_this_pass_usd: 0,
    spend_estimate_cumulative_usd: PRIOR_SPEND,
    product: {
      settle: "measured by analyzeTake and applied as the manifest in-point (picture and native audio trimmed together)",
      pad: "applied only where the measured voice onset leads the mouth by more than the trigger",
      gate: "auditMux on the final bytes; identical gate to renderEpisode",
    },
  };
  await writeFile(AUDIT, JSON.stringify(report, null, 2));
  await writeFile(audit.ship ? OUT : FAIL_OUT, rendered.body);
  process.stdout.write(
    `LOCK V9 (engine) ${audit.ship ? "PASS" : "FAIL"} ${audit.ship ? OUT : FAIL_OUT} · ${audit.duration_seconds.toFixed(2)}s · ${audit.reasons.join(",") || "clean"} · sha256 ${sha256}\n`,
  );
  if (!audit.ship) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
