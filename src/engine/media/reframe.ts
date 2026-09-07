import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

/**
 * Additional deliverables cut from the 9:16 master. The master is the only
 * thing the pipeline renders from takes; these are re-frames of that file so
 * every aspect ships the same edit, captions and mix.
 */
export type DeliverableAspect = "9:16" | "1:1" | "16:9";

export const DELIVERABLE_SIZES: Record<DeliverableAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

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

/**
 * Video filter per aspect. Square: centre crop of the vertical master, which
 * keeps the face band and the caption band (captions sit at 70–82% of height,
 * inside the middle 56% we keep). Landscape: the master pillarboxed over a
 * blurred, darkened copy of itself — the standard vertical-on-TV treatment.
 */
export function reframeFilter(aspect: DeliverableAspect): string {
  const size = DELIVERABLE_SIZES[aspect];
  if (aspect === "9:16") return `scale=${size.width}:${size.height},format=yuv420p`;
  if (aspect === "1:1") {
    // 1080x1920 → crop rows ~513–1593: the face band (CU eyes/mouth ~30–55%)
    // and the caption band (70–82%) both stay inside the square.
    return `crop=iw:iw:0:(ih-iw)*0.61,scale=${size.width}:${size.height}:flags=lanczos,format=yuv420p`;
  }
  return (
    `split[bg][fg];` +
    `[bg]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},boxblur=24:8,eq=brightness=-0.18:saturation=0.8[bgb];` +
    `[fg]scale=-2:${size.height}:flags=lanczos[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:0,format=yuv420p`
  );
}

export async function reframeMp4(master: Uint8Array, aspect: DeliverableAspect): Promise<Uint8Array | null> {
  if (aspect === "9:16") return master;
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-reframe-"));
  try {
    const input = join(dir, "master.mp4");
    const output = join(dir, `out-${aspect.replace(":", "x")}.mp4`);
    await writeFile(input, master);
    const filter = reframeFilter(aspect);
    await run("ffmpeg", [
      "-y",
      "-i",
      input,
      ...(filter.includes("[") ? ["-filter_complex", filter] : ["-vf", filter]),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
