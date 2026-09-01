import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import type { IdentityJudgement, VisionEngine } from "../ai/vision.ts";
import type { TakeAnalysis } from "./take-analysis.ts";

/**
 * Identity stage for one take. Samples a few frames after the settle point and
 * asks the vision judge two questions the pixel heuristics could not answer
 * reliably: how many people are in frame, and is this the locked cast member.
 * Results land on the take analysis so `scoreTake` can block on them.
 */
export type IdentityStageInput = {
  video: Uint8Array;
  /** Locked CU still for the pictured cast member; null for empty wides and inserts. */
  reference: Uint8Array | null;
  referenceMime?: string;
  analysis: TakeAnalysis;
  /** People the plan put in the frame: 0 for an empty room, 1 for a single. */
  expectedFaces: number;
  description?: string | null;
  vision: VisionEngine;
  /** Override frame sampling (tests). */
  sampleFrames?: (video: Uint8Array, atSeconds: number[]) => Promise<Uint8Array[]>;
};

export type IdentityStageResult = {
  analysis: TakeAnalysis;
  judgement: IdentityJudgement | null;
  /** Why the judge did not run or was ignored. */
  skipped: string | null;
};

const FRAME_W = 360;
const FRAME_H = 640;

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => resolve({ ok: false, stdout: Buffer.alloc(0) }));
    child.on("exit", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(chunks) }));
  });
}

/** Where to look: just after the morph, mid-take, and near the tail. */
export function identitySampleTimes(analysis: Pick<TakeAnalysis, "duration_seconds" | "settle_in_seconds">): number[] {
  const duration = Math.max(0.5, analysis.duration_seconds);
  const first = Math.min(duration - 0.2, analysis.settle_in_seconds + 0.25);
  const last = Math.max(first, duration - 0.35);
  const mid = (first + last) / 2;
  const times = [first, mid, last].map((t) => Number(Math.max(0, t).toFixed(2)));
  return [...new Set(times)];
}

export async function sampleJpegFrames(video: Uint8Array, atSeconds: number[]): Promise<Uint8Array[]> {
  if (!(await ffmpegAvailable())) return [];
  const dir = await mkdtemp(join(tmpdir(), "sdm-identity-"));
  try {
    const path = join(dir, "take.mp4");
    await writeFile(path, video);
    const frames: Uint8Array[] = [];
    for (const at of atSeconds) {
      const raw = await run("ffmpeg", [
        "-y", "-ss", at.toFixed(2), "-i", path,
        "-frames:v", "1", "-vf", `scale=${FRAME_W}:${FRAME_H}`, "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
      ]);
      if (raw.ok && raw.stdout.byteLength > 512) frames.push(new Uint8Array(raw.stdout));
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runIdentityStage(input: IdentityStageInput): Promise<IdentityStageResult> {
  const sample = input.sampleFrames ?? sampleJpegFrames;
  if (input.video.byteLength < 2_000) return { analysis: input.analysis, judgement: null, skipped: "take_too_small" };
  let frames: Uint8Array[];
  try {
    frames = await sample(input.video, identitySampleTimes(input.analysis));
  } catch {
    return { analysis: input.analysis, judgement: null, skipped: "frame_sampling_failed" };
  }
  if (!frames.length) return { analysis: input.analysis, judgement: null, skipped: "no_frames" };
  try {
    const judgement = await input.vision.judgeIdentity({
      reference: input.reference,
      referenceMime: input.referenceMime,
      frames,
      expectedFaces: input.expectedFaces,
      description: input.description,
    });
    return {
      analysis: {
        ...input.analysis,
        face_count: judgement.face_count,
        // Without a reference the judge cannot score likeness; leave it unknown
        // rather than recording a fake 1.0 as if the face had been checked.
        face_similarity: input.reference ? Number(judgement.same_person.toFixed(3)) : null,
      },
      judgement,
      skipped: null,
    };
  } catch (error) {
    return {
      analysis: input.analysis,
      judgement: null,
      skipped: `judge_failed:${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
    };
  }
}
