import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePortraitSlate } from "./ffmpeg-mix.ts";
import { inventedSecondBody } from "./second-body.ts";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${code}`))));
  });
}

describe("second body", () => {
  it("does not flag a single-subject color slate", async () => {
    if (!(await ffmpegAvailable())) return;
    const slate = await encodePortraitSlate(1);
    expect(slate).toBeTruthy();
    await expect(inventedSecondBody(slate!)).resolves.toBe(false);
  });

  it("rejects an OTS silhouette that the locked still does not have", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-ots-"));
    try {
      const stillPath = join(dir, "still.png");
      const takePath = join(dir, "ots.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0xC4A882:s=720x1280:d=1",
        "-frames:v",
        "1",
        stillPath,
      ]);
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0xC4A882:s=720x1280:d=2:r=30",
        "-vf",
        "drawbox=x=0:y=80:w=170:h=520:color=black:t=fill",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-an",
        takePath,
      ]);
      const still = new Uint8Array(await readFile(stillPath));
      const take = new Uint8Array(await readFile(takePath));
      await expect(inventedSecondBody(take, still)).resolves.toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
