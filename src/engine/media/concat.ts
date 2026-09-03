import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { cuesFromVtt, cuesToVtt, type CaptionCue } from "../pipeline/captions.ts";
import type { RenderManifest } from "../domain.ts";

/**
 * Joins block renders into one programme. Every block is encoded by the same
 * mixer with the same parameters (720x1280@30 H.264, 48 kHz stereo AAC), so
 * the join is a stream copy: no second generation of encoding, and a block
 * that already rendered is never touched again.
 */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-600)}`))));
  });
}

export async function concatMp4Segments(segments: readonly Uint8Array[]): Promise<Uint8Array | null> {
  if (!segments.length) return null;
  if (segments.length === 1) return segments[0]!;
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-concat-"));
  try {
    const files: string[] = [];
    for (const [index, body] of segments.entries()) {
      const file = join(dir, `seg-${String(index).padStart(3, "0")}.mp4`);
      await writeFile(file, body);
      files.push(file);
    }
    const list = join(dir, "list.txt");
    await writeFile(list, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
    const out = join(dir, "programme.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runStderr(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", () => resolve(""));
    child.on("exit", () => resolve(stderr));
  });
}

/**
 * Blocks are normalised one at a time, so a programme with quiet cutaways
 * lands under target once they are joined. Measure the whole programme and
 * apply one linear gain (dynamics untouched), with a true-peak limiter so the
 * gain cannot push peaks over the delivery ceiling. Audio only; video copied.
 */
export async function normalizeProgrammeLoudness(
  programme: Uint8Array,
  target: { lufs: number; truePeakDb: number },
): Promise<{ body: Uint8Array; measured: number | null; gainDb: number }> {
  if (!(await ffmpegAvailable())) return { body: programme, measured: null, gainDb: 0 };
  const dir = await mkdtemp(join(tmpdir(), "sdm-prog-loud-"));
  try {
    const input = join(dir, "programme.mp4");
    await writeFile(input, programme);
    const stderr = await runStderr("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", "ebur128=peak=true", "-f", "null", "-"]);
    const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf("Summary:")));
    const measured = integrated ? Number(integrated[1]) : null;
    if (measured == null || !Number.isFinite(measured)) return { body: programme, measured: null, gainDb: 0 };
    const gainDb = Number((target.lufs - measured).toFixed(2));
    if (Math.abs(gainDb) < 0.3) return { body: programme, measured, gainDb: 0 };
    const out = join(dir, "programme-loud.mp4");
    await run("ffmpeg", [
      "-y",
      "-i",
      input,
      "-af",
      `volume=${gainDb}dB,alimiter=limit=${Math.pow(10, target.truePeakDb / 20).toFixed(4)}:attack=5:release=50:level=false`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      out,
    ]);
    return { body: new Uint8Array(await readFile(out)), measured, gainDb };
  } catch {
    // The audit still measures the file; an un-normalised programme fails there, not silently.
    return { body: programme, measured: null, gainDb: 0 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Shift a block's cues onto the programme clock. */
export function shiftCues(vtt: string, offsetSeconds: number): CaptionCue[] {
  return cuesFromVtt(vtt).map((cue) => ({ ...cue, start: cue.start + offsetSeconds, end: cue.end + offsetSeconds }));
}

export function mergeVtt(blocks: ReadonlyArray<{ vtt: string; offsetSeconds: number }>): string {
  return cuesToVtt(blocks.flatMap((block) => shiftCues(block.vtt, block.offsetSeconds)));
}

/** Merge block manifests onto one programme clock. */
export function mergeManifests(
  episodeId: string,
  blocks: ReadonlyArray<{ manifest: RenderManifest; offsetSeconds: number }>,
): RenderManifest {
  const shots = blocks.flatMap((block) =>
    block.manifest.shots.map((shot) => ({
      ...shot,
      picture_start_seconds: (shot.picture_start_seconds ?? 0) + block.offsetSeconds,
      audio_start_seconds: shot.audio_start_seconds == null ? shot.audio_start_seconds : shot.audio_start_seconds + block.offsetSeconds,
    })),
  );
  let sceneIndex = 0;
  const scenes = blocks.flatMap((block) =>
    (block.manifest.scenes ?? []).map((scene) => ({ ...scene, index: sceneIndex++ })),
  );
  return {
    version: 1,
    episode_id: episodeId,
    shots,
    caption_asset_ids: blocks.flatMap((block) => block.manifest.caption_asset_ids),
    music_asset_ids: [],
    sfx_asset_ids: [],
    transitions: blocks.flatMap((block) => block.manifest.transitions),
    scenes,
  };
}
