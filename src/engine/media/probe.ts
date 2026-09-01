import type { ProbeResult } from "./qc.ts";

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
