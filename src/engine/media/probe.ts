import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProbeResult } from "./qc.ts";

/**
 * Header parse first; ffprobe when the header has no answer (fragmented MP4
 * from some providers carries no mvhd duration and no tkhd size).
 */
export async function probeVideoBytesAsync(bytes: Uint8Array): Promise<ProbeResult> {
  const quick = probeVideoBytes(bytes);
  if (quick.duration_seconds > 0 && quick.width > 0) return quick;
  const dir = await mkdtemp(join(tmpdir(), "sdm-probe-"));
  try {
    const file = join(dir, "take.mp4");
    await writeFile(file, bytes);
    const out = await new Promise<string>((resolve) => {
      const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { stdio: ["ignore", "pipe", "ignore"] });
      let text = "";
      child.stdout?.on("data", (chunk) => {
        text += String(chunk);
      });
      child.on("error", () => resolve(""));
      child.on("exit", () => resolve(text));
    });
    const parsed = JSON.parse(out || "{}") as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
    const video = parsed.streams?.find((row) => row.codec_type === "video");
    return {
      ...quick,
      duration_seconds: quick.duration_seconds > 0 ? quick.duration_seconds : Number(parsed.format?.duration ?? 0) || 0,
      width: quick.width > 0 ? quick.width : video?.width ?? 0,
      height: quick.height > 0 ? quick.height : video?.height ?? 0,
      has_audio: quick.has_audio || Boolean(parsed.streams?.some((row) => row.codec_type === "audio")),
    };
  } catch {
    return quick;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function readU64(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 2 ** 32 + low;
}

type Box = { type: string; start: number; end: number; payload: number };

function readBox(bytes: Uint8Array, offset: number): Box | null {
  if (offset + 8 > bytes.byteLength) return null;
  let size = readU32(bytes, offset);
  const type = readAscii(bytes, offset + 4, 4);
  let payload = offset + 8;
  if (size === 1) {
    if (offset + 16 > bytes.byteLength) return null;
    size = readU64(bytes, offset + 8);
    payload = offset + 16;
  }
  if (size < 8 || offset + size > bytes.byteLength) return null;
  return { type, start: offset, end: offset + size, payload };
}

function walk(bytes: Uint8Array, start: number, end: number, visit: (box: Box) => void) {
  let offset = start;
  while (offset < end) {
    const box = readBox(bytes, offset);
    if (!box) break;
    visit(box);
    if (["moov", "trak", "mdia", "minf"].includes(box.type)) {
      walk(bytes, box.payload, box.end, visit);
    }
    offset = box.end;
  }
}

export function probeVideoBytes(bytes: Uint8Array): ProbeResult {
  const result: ProbeResult = {
    exists: bytes.byteLength > 0,
    decodes: false,
    duration_seconds: 0,
    width: 0,
    height: 0,
    has_audio: false,
    black_frames: false,
  };
  if (!result.exists) return result;

  let timescale = 0;
  let durationUnits = 0;
  walk(bytes, 0, bytes.byteLength, (box) => {
    if (box.type === "ftyp") result.decodes = true;
    if (box.type === "hdlr" && box.payload + 16 <= box.end) {
      if (readAscii(bytes, box.payload + 8, 4) === "soun") result.has_audio = true;
    }
    if (box.type === "mvhd" && box.payload + 24 <= box.end) {
      const version = bytes[box.payload] ?? 0;
      if (version === 1 && box.payload + 32 <= box.end) {
        timescale = readU32(bytes, box.payload + 20);
        durationUnits = readU64(bytes, box.payload + 24);
      } else {
        timescale = readU32(bytes, box.payload + 12);
        durationUnits = readU32(bytes, box.payload + 16);
      }
    }
    if (box.type === "tkhd" && box.payload + 84 <= box.end) {
      const version = bytes[box.payload] ?? 0;
      const dim = version === 1 ? box.payload + 88 : box.payload + 76;
      if (dim + 8 <= box.end) {
        const width = readU32(bytes, dim) / 65536;
        const height = readU32(bytes, dim + 4) / 65536;
        // Audio tracks carry a 0x0 tkhd; the first sized track is the picture.
        if (width > 0 && height > 0 && result.width === 0) {
          result.width = Math.round(width);
          result.height = Math.round(height);
        }
      }
    }
  });

  if (timescale > 0) {
    result.duration_seconds = durationUnits / timescale;
  }
  return result;
}
