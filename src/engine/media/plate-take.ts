import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

/**
 * An establishing wide cut from the locked location plate itself: a slow push
 * or drift over the still, 30 fps, silent. Every video model tried invents a
 * person in an "empty room" prompt often enough that a paying user cannot be
 * shown the result; the plate has no one in it by construction, matches the
 * scene's lighting exactly, and costs nothing to generate.
 */
export type PlateMove = "push_in" | "pull_out" | "drift_left" | "drift_right";

export const PLATE_TAKE_FPS = 30;
export const PLATE_TAKE_WIDTH = 1080;
export const PLATE_TAKE_HEIGHT = 1920;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-600)}`))));
  });
}

/** zoompan expression for the move; the plate is oversampled 2x first so the pan stays crisp. */
export function plateMoveFilter(move: PlateMove, seconds: number): string {
  const frames = Math.max(1, Math.round(seconds * PLATE_TAKE_FPS));
  const w = PLATE_TAKE_WIDTH;
  const h = PLATE_TAKE_HEIGHT;
  // 1.0 → 1.12 over the take, or the reverse; drifts hold zoom 1.08 and slide.
  const zoomIn = `1+0.12*on/${frames}`;
  const zoomOut = `1.12-0.12*on/${frames}`;
  const centreX = "iw/2-(iw/zoom/2)";
  const centreY = "ih/2-(ih/zoom/2)";
  const expr =
    move === "push_in"
      ? `z='${zoomIn}':x='${centreX}':y='${centreY}'`
      : move === "pull_out"
        ? `z='${zoomOut}':x='${centreX}':y='${centreY}'`
        : move === "drift_left"
          ? `z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':y='${centreY}'`
          : `z='1.08':x='(iw-iw/zoom)*(on/${frames})':y='${centreY}'`;
  return (
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
    `zoompan=${expr}:d=${frames}:s=${w}x${h}:fps=${PLATE_TAKE_FPS},` +
    `eq=contrast=1.02:saturation=1.02,format=yuv420p`
  );
}

/** Deterministic move choice from the shot id so re-renders match. */
export function plateMoveFor(seed: string): PlateMove {
  const moves: PlateMove[] = ["push_in", "pull_out", "drift_left", "drift_right"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return moves[hash % moves.length]!;
}

export async function plateTake(plate: Uint8Array, seconds: number, move: PlateMove): Promise<Uint8Array | null> {
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-plate-"));
  try {
    const input = join(dir, "plate.png");
    const output = join(dir, "take.mp4");
    await writeFile(input, plate);
    const duration = Math.max(2, Math.min(8, seconds));
    await run("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-i",
      input,
      "-vf",
      plateMoveFilter(move, duration),
      "-t",
      duration.toFixed(3),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      output,
    ]);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
