import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CutDetectResult = {
  internal_cut_count: number;
  method: "ffmpeg_scene" | "unavailable";
};

export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Counts hard scene changes inside a single take. Pass `skipSeconds` (the
 * measured I2V settle) so the still→scene morph at the head is not counted;
 * that morph is the source of the Wan `internal_cut` false positives.
 */
export async function detectInternalCuts(
  bytes: Uint8Array,
  threshold = 0.3,
  options: { skipSeconds?: number } = {},
): Promise<CutDetectResult> {
  if (bytes.byteLength < 8_192) return { internal_cut_count: 0, method: "unavailable" };
  const has = await ffmpegAvailable();
  if (!has) return { internal_cut_count: 0, method: "unavailable" };
  const dir = await mkdtemp(join(tmpdir(), "sdm-cuts-"));
  const input = join(dir, "shot.mp4");
  try {
    await writeFile(input, bytes);
    const skip = Math.max(0, options.skipSeconds ?? 0);
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          ...(skip > 0 ? ["-ss", skip.toFixed(2)] : []),
          "-i",
          input,
          "-filter:v",
          `select='gt(scene,${threshold})',showinfo`,
          "-f",
          "null",
          "-",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0 || code === 1) resolve(stderr);
        else reject(new Error(`ffmpeg scene detect exited ${code}`));
      });
    });
    const hits = raw.match(/pts_time:/g)?.length ?? 0;
    return { internal_cut_count: Math.max(0, hits), method: "ffmpeg_scene" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function lockedTakeRejected(editMode: string | undefined, internalCutCount: number | null | undefined): boolean {
  return (editMode ?? "locked_take") === "locked_take" && (internalCutCount ?? 0) >= 1;
}
