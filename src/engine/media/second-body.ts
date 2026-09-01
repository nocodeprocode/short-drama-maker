import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

const W = 48;
const H = 64;
const SAMPLE_AT = [0.35, 1.0, 1.6];

function skin(r: number, g: number, b: number): boolean {
  return r > 80 && r > g + 8 && r > b + 6 && g > 40 && b > 30 && r < 240;
}

function luma(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function blobCount(pixels: Buffer): number {
  const seen = new Uint8Array(W * H);
  const blobs: Array<{ n: number; cx: number; cy: number }> = [];
  const idx = (x: number, y: number) => y * W + x;
  for (let y = 0; y < Math.round(H * 0.62); y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = idx(x, y);
      if (seen[i]) continue;
      const o = i * 3;
      if (!skin(pixels[o] ?? 0, pixels[o + 1] ?? 0, pixels[o + 2] ?? 0)) continue;
      let n = 0;
      let sx = 0;
      let sy = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % W;
        const cy = Math.floor(cur / W);
        n += 1;
        sx += cx;
        sy += cy;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = idx(nx, ny);
          if (seen[ni]) continue;
          const no = ni * 3;
          if (!skin(pixels[no] ?? 0, pixels[no + 1] ?? 0, pixels[no + 2] ?? 0)) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (n >= Math.round(W * H * 0.045)) blobs.push({ n, cx: sx / n, cy: sy / n });
    }
  }
  const big = blobs.filter((row) => row.n >= Math.round(W * H * 0.05));
  if (big.length < 2) return big.length;
  let separated = 0;
  for (let i = 0; i < big.length; i += 1) {
    for (let j = i + 1; j < big.length; j += 1) {
      const dx = big[i]!.cx - big[j]!.cx;
      const dy = big[i]!.cy - big[j]!.cy;
      if (Math.hypot(dx, dy) >= 12) separated += 1;
    }
  }
  return separated > 0 ? 2 : 1;
}

function stripStats(pixels: Buffer, x0: number, x1: number): { mean: number; dark: number } {
  const y1 = Math.round(H * 0.58);
  let sum = 0;
  let dark = 0;
  let n = 0;
  for (let y = 0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const o = (y * W + x) * 3;
      const v = luma(pixels[o] ?? 0, pixels[o + 1] ?? 0, pixels[o + 2] ?? 0);
      sum += v;
      if (v < 48) dark += 1;
      n += 1;
    }
  }
  return { mean: n ? sum / n : 0, dark: n ? dark / n : 0 };
}

/** OTS / over-shoulder: a dark second head occupies a side strip that the locked still does not. */
function edgeSilhouette(video: Buffer, still: Buffer | null): boolean {
  const leftW = Math.round(W * 0.22);
  const right0 = W - leftW;
  let leftHit = false;
  let rightHit = false;
  for (const [x0, x1, side] of [
    [0, leftW, "left"] as const,
    [right0, W, "right"] as const,
  ]) {
    const take = stripStats(video, x0, x1);
    if (!still) continue;
    const plate = stripStats(still, x0, x1);
    const hit = take.dark > plate.dark + 0.22 && take.mean < plate.mean - 22;
    if (side === "left") leftHit = hit;
    else rightHit = hit;
  }
  // Night CUs darken both edges (window bokeh). OTS occupies one side only.
  return (leftHit || rightHit) && !(leftHit && rightHit);
}

async function frameRgb(path: string, kind: "image" | "video", ss = 0.35): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const args = [
      "-y",
      ...(kind === "video" ? ["-ss", ss.toFixed(2)] : []),
      "-i",
      path,
      "-vf",
      `scale=${W}:${H},format=rgb24`,
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
      const raw = Buffer.concat(chunks);
      resolve(code === 0 && raw.byteLength >= W * H * 3 ? raw.subarray(0, W * H * 3) : null);
    });
  });
}

/** Dialogue CU that grew a second torso / ghost head / OTS silhouette. */
export async function inventedSecondBody(video: Uint8Array, still?: Uint8Array | null): Promise<boolean> {
  if (video.byteLength < 2_000 || !(await ffmpegAvailable())) return false;
  const dir = await mkdtemp(join(tmpdir(), "sdm-body-"));
  try {
    const take = join(dir, "take.mp4");
    await writeFile(take, video);
    let stillFrame: Buffer | null = null;
    if (still && still.byteLength >= 32) {
      const plate = join(dir, "still.png");
      await writeFile(plate, still);
      stillFrame = await frameRgb(plate, "image");
    }
    const stillBlobs = stillFrame ? blobCount(stillFrame) : 0;
    let hits = 0;
    for (const ss of SAMPLE_AT) {
      const frame = await frameRgb(take, "video", ss);
      if (!frame) continue;
      const videoBlobs = blobCount(frame);
      const twoHeads = stillFrame ? videoBlobs >= 2 && videoBlobs > stillBlobs : videoBlobs >= 3;
      if (twoHeads || edgeSilhouette(frame, stillFrame)) hits += 1;
    }
    return hits >= 1;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
