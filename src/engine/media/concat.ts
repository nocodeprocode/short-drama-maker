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
