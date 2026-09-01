import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function extractAudioMp3(video: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sdm-stt-"));
  const input = join(dir, "shot.mp4");
  const output = join(dir, "shot.mp3");
  try {
    await writeFile(input, video);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-y", "-i", input, "-vn", "-q:a", "4", output], {
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg extract audio exited ${code}`));
      });
    });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
