import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

export type Rgb = readonly [number, number, number];

const SAMPLE = 32;

export function rgbDistance(left: Rgb, right: Rgb): number {
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function identityDrifted(still: Rgb, frame: Rgb, threshold = 88): boolean {
  return rgbDistance(still, frame) >= threshold;
}

export async function meanRgb(
  bytes: Uint8Array,
  kind: "image" | "video" = "image",
): Promise<Rgb | null> {
  if (bytes.byteLength < 32 || !(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-rgb-"));
  const input = join(dir, kind === "video" ? "take.mp4" : "still.png");
  try {
    await writeFile(input, bytes);
    const raw = await new Promise<Buffer | null>((resolve) => {
      const args = [
        "-y",
        ...(kind === "video" ? ["-ss", "0.5"] : []),
        "-i",
        input,
        "-vf",
        `crop=iw*0.55:ih*0.42:(iw-iw*0.55)/2:ih*0.08,scale=${SAMPLE}:${SAMPLE},format=rgb24`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ];
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", () => resolve(null));
      child.on("exit", (code) => {
        if (code !== 0) resolve(null);
        else resolve(Buffer.concat(chunks));
      });
    });
    if (!raw || raw.byteLength < SAMPLE * SAMPLE * 3) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    const pixels = SAMPLE * SAMPLE;
    for (let i = 0; i < pixels; i += 1) {
      r += raw[i * 3] ?? 0;
      g += raw[i * 3 + 1] ?? 0;
      b += raw[i * 3 + 2] ?? 0;
    }
    return [r / pixels, g / pixels, b / pixels];
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
