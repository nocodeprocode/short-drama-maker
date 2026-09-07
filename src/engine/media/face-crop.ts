import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";

export type ImageSize = { width: number; height: number };
export type CropBox = { x: number; y: number; width: number; height: number };

const PORTRAIT = 9 / 16;
export const CU_CROP_VERSION = "cu-face-v1";

export function probeImageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.byteLength >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.byteLength > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1] ?? 0;
      const size = (bytes[offset + 2] ?? 0) * 256 + (bytes[offset + 3] ?? 0);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < bytes.byteLength) {
        return {
          height: (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0),
          width: (bytes[offset + 7] ?? 0) * 256 + (bytes[offset + 8] ?? 0),
        };
      }
      offset += 2 + size;
    }
  }
  return null;
}

export function cuCropBox(width: number, height: number, kind?: string | null): CropBox {
  const portrait = height > width;
  const fullBody = kind === "full_body" || (portrait && height / width >= 1.6);
  const windowHeight = Math.max(16, Math.round(height * (fullBody ? 0.28 : 0.72)));
  const windowWidth = Math.max(16, Math.round(windowHeight * PORTRAIT));
  const widthClamped = Math.min(width, windowWidth);
  const heightClamped = Math.min(height, Math.round(widthClamped / PORTRAIT));
  const x = Math.max(0, Math.round((width - widthClamped) / 2));
  const y = fullBody ? Math.round(height * 0.03) : Math.max(0, Math.round((height - heightClamped) * 0.18));
  return {
    x,
    y: Math.min(y, Math.max(0, height - heightClamped)),
    width: widthClamped,
    height: heightClamped,
  };
}

export function firstFrameKind(kind?: string | null): "cu" | "face" | "full_body" | "object" | "wardrobe" {
  if (kind === "object_insert" || kind === "phone_ui") return "object";
  if (kind === "full_body") return "full_body";
  if (kind === "cu" || kind === "mcu" || kind === "blocking_still" || kind === "last_frame") return "cu";
  if (kind === "default_wardrobe" || kind?.startsWith("look:")) return "wardrobe";
  if (kind === "front" || kind === "three_quarter" || kind === "profile") return "face";
  return "face";
}

const CU_FUNCTIONS = new Set([
  "hook_cu",
  "accusation_cu",
  "listener_hold",
  "button_cu",
  "reaction",
  "dialogue",
]);

export function firstFrameQc(input: {
  shotFunction?: string | null;
  firstFrameKind: ReturnType<typeof firstFrameKind>;
  objectInsert?: boolean;
  policy?: "face_first" | "wardrobe_first" | "face_only";
}): { ok: boolean; reason: string | null } {
  if (input.objectInsert || input.shotFunction === "insert_evidence" || input.shotFunction === "phone_ui") {
    return input.firstFrameKind === "object"
      ? { ok: true, reason: null }
      : { ok: false, reason: "insert_used_face_still" };
  }
  if (
    CU_FUNCTIONS.has(input.shotFunction ?? "") &&
    input.firstFrameKind === "full_body" &&
    input.policy !== "wardrobe_first"
  ) {
    return { ok: false, reason: "first_frame_not_cu" };
  }
  return { ok: true, reason: null };
}

/**
 * A 9:16 close-up window around a located face: the face fills ~40% of the
 * frame height with its eyes near the upper third, which is the framing the
 * dialogue CUs are prompted for. Clamped to the image.
 */
export function cuCropBoxFromFace(
  width: number,
  height: number,
  face: { x: number; y: number; width: number; height: number },
): CropBox {
  const faceH = face.height * height;
  const faceCx = (face.x + face.width / 2) * width;
  const faceCy = (face.y + face.height / 2) * height;
  // Face ~55% of the window height; clamped so the result is always a close-up
  // (never the whole figure) and never smaller than the v9 lock's 28% window.
  let windowH = Math.round(Math.min(height * 0.5, Math.max(faceH * 1.8, height * 0.28)));
  let windowW = Math.round(windowH * PORTRAIT);
  if (windowW > width) {
    windowW = width;
    windowH = Math.round(windowW / PORTRAIT);
  }
  if (windowH > height) {
    windowH = height;
    windowW = Math.round(windowH * PORTRAIT);
  }
  // Face centre sits at ~42% of the window height.
  const x = Math.round(Math.min(Math.max(0, faceCx - windowW / 2), width - windowW));
  const y = Math.round(Math.min(Math.max(0, faceCy - windowH * 0.42), height - windowH));
  return { x, y, width: windowW, height: windowH };
}

export async function cropStillToCu(
  bytes: Uint8Array,
  kind?: string | null,
  face?: { x: number; y: number; width: number; height: number } | null,
): Promise<Uint8Array | null> {
  const size = probeImageSize(bytes);
  if (!size || size.width < 32 || size.height < 32) return null;
  const box = face ? cuCropBoxFromFace(size.width, size.height, face) : cuCropBox(size.width, size.height, kind);
  if (!(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-cu-"));
  const input = join(dir, "still.png");
  const output = join(dir, "cu.png");
  try {
    await writeFile(input, bytes);
    // Crop, then upscale to the take's frame so the I2V first frame is not a tiny window.
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        "ffmpeg",
        ["-y", "-i", input, "-vf", `crop=${box.width}:${box.height}:${box.x}:${box.y},scale=720:1280:flags=lanczos`, output],
        { stdio: "ignore" },
      );
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
    if (!ok) return null;
    return new Uint8Array(await readFile(output));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
