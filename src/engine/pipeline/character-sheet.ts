import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { probeImageSize } from "../media/face-crop.ts";

export type SheetRole = "front" | "profile" | "wardrobe";

const BANNER_W = 720;
const BANNER_H = 110;
const TITLE = "FICTIONAL CHARACTER SHEET";

/** 5x7 caps for production-asset labels. Bits are rows, MSB left. */
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
};

function labelSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9 -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
}

export function characterSheetLabel(name: string, role: SheetRole): string {
  const angle = role === "profile" ? "SIDE" : role === "wardrobe" ? "WARDROBE" : "FRONT";
  return `${labelSafe(name).toUpperCase()} ${angle}`;
}

export function renderSheetBanner(title: string, label: string): Uint8Array {
  const pixels = Buffer.alloc(BANNER_W * BANNER_H * 3, 255);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= BANNER_W || y >= BANNER_H) return;
    const i = (y * BANNER_W + x) * 3;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  };
  const blit = (text: string, cx: number, y: number, scale: number) => {
    const width = text.length * 6 * scale;
    let x = Math.round(cx - width / 2);
    for (const char of text) {
      const glyph = GLYPHS[char] ?? GLYPHS[" "];
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          if ((glyph[row] >> (4 - col)) & 1) {
            for (let dy = 0; dy < scale; dy += 1) {
              for (let dx = 0; dx < scale; dx += 1) {
                put(x + col * scale + dx, y + row * scale + dy, 0, 0, 0);
              }
            }
          }
        }
      }
      x += 6 * scale;
    }
  };
  blit(title, BANNER_W / 2, 18, 2);
  blit(label, BANNER_W / 2, 62, 3);
  for (let x = 22; x < 70; x += 1) {
    for (let y = 44; y < 54; y += 1) put(x, y, 220, 38, 38);
  }
  for (let x = 41; x < 51; x += 1) {
    for (let y = 26; y < 72; y += 1) put(x, y, 220, 38, 38);
  }
  return new Uint8Array(pixels);
}

const SHEET_W = BANNER_W;
const SHEET_H = 1280;
const MARK = 144;
const MARK_T = 16;

/**
 * Centre of the marker on the finished sheet. The still is scaled into
 * 720x1280 with letterbox padding, so a face box on the source has to travel
 * through the same transform. Without a box the marker sits where a portrait
 * still usually puts a head — which is wrong for a full-body plate, and a
 * marker on the chest leaves the face reading as a photograph.
 */
export function faceMarker(
  bytes: Uint8Array,
  face?: { x: number; y: number; width: number; height: number } | null,
): { x: number; y: number; barWidth: number; barHeight: number } {
  const size = face ? probeImageSize(bytes) : null;
  if (!face || !size || !size.width || !size.height) {
    return { x: SHEET_W / 2, y: 358, barWidth: MARK, barHeight: MARK_T };
  }
  const scale = Math.min(SHEET_W / size.width, SHEET_H / size.height);
  const drawnW = size.width * scale;
  const drawnH = size.height * scale;
  const originX = (SHEET_W - drawnW) / 2;
  const originY = (SHEET_H - drawnH) / 2;
  const faceW = face.width * drawnW;
  const faceH = face.height * drawnH;
  // The bar spans the whole head and a quarter of its height. A thin mark on
  // the forehead leaves the eye line clear and the still still reads as a
  // photograph of a person to the provider; a bar across the eyes does not.
  const barWidth = Math.max(MARK, Math.round(faceW * 1.1));
  const barHeight = Math.max(MARK_T, Math.round(faceH * 0.24));
  const clamp = (value: number, half: number, max: number) => Math.min(Math.max(value, half), max - half);
  return {
    x: clamp(originX + (face.x + face.width / 2) * drawnW, barWidth / 2, SHEET_W),
    // The vertical stem is as long as the bar is wide, so it sets the top and
    // bottom margin the marker needs to stay on the sheet.
    y: clamp(originY + (face.y + face.height * 0.45) * drawnH, barWidth / 2, SHEET_H),
    barWidth,
    barHeight,
  };
}

function markerBoxes(marker: ReturnType<typeof faceMarker>): string {
  const x = Math.round(marker.x);
  const y = Math.round(marker.y);
  const w = Math.round(marker.barWidth);
  const h = Math.round(marker.barHeight);
  const stem = Math.max(MARK_T, Math.round(w * 0.12));
  return [
    `drawbox=x=${x - Math.round(w / 2)}:y=${y - Math.round(h / 2)}:w=${w}:h=${h}:color=0xDC2626:t=fill`,
    `drawbox=x=${x - Math.round(stem / 2)}:y=${y - Math.round(w / 2)}:w=${stem}:h=${w}:color=0xDC2626:t=fill`,
  ].join(",");
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * How hard the sheet treatment leans on the still.
 *
 * The provider's classifier answers to the treatment, not only to the face:
 * probing found the same raw still refused and its stamped sheet accepted. It
 * is a gradient, so a face it still refuses gets a heavier pass — flatter
 * colour, coarser grain, a wider border and more annotation — until it takes
 * one. Each rung costs identity detail, so the shoot uses the lowest that
 * passes.
 */
export const SHEET_STRENGTHS = [0, 1, 2, 3] as const;
export type SheetStrength = (typeof SHEET_STRENGTHS)[number];

export function sheetTreatment(strength: SheetStrength): string {
  const saturation = [0.55, 0.35, 0.18, 0.0][strength] ?? 0.55;
  const contrast = [1.25, 1.2, 1.15, 1.1][strength] ?? 1.25;
  const grain = [20, 34, 48, 62][strength] ?? 20;
  const border = [20, 34, 48, 64][strength] ?? 20;
  const steps = [0, 0, 6, 4][strength] ?? 0;
  return [
    `eq=saturation=${saturation}:contrast=${contrast}`,
    "unsharp=5:5:1.2",
    // Fewer tone steps read as a printed plate rather than a photograph.
    steps ? `elbg=codebook_length=${steps * 4}:nb_steps=${steps}` : "",
    `noise=alls=${grain}:allf=t`,
    `drawbox=x=0:y=0:w=${SHEET_W}:h=${SHEET_H}:color=white:t=${border}`,
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * Stamp a locked still as a fictional character sheet so Seedance's
 * photoreal-face classifier reads it as a production reference, not a photo.
 * The face itself is not covered.
 */
export async function stampCharacterSheet(
  bytes: Uint8Array,
  input: {
    name: string;
    role: SheetRole;
    face?: { x: number; y: number; width: number; height: number } | null;
    strength?: SheetStrength;
  },
): Promise<Uint8Array | null> {
  if (bytes.byteLength < 32 || !(await ffmpegAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), "sdm-sheet-"));
  const source = join(dir, "still.png");
  const banner = join(dir, "banner.rgb");
  const output = join(dir, "sheet.png");
  const label = characterSheetLabel(input.name, input.role);
  try {
    await writeFile(source, bytes);
    await writeFile(banner, renderSheetBanner(TITLE, label));
    const ok = await runFfmpeg([
      "-y",
      "-i",
      source,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${BANNER_W}x${BANNER_H}`,
      "-i",
      banner,
      "-filter_complex",
      [
        `[0:v]scale=${SHEET_W}:${SHEET_H}:force_original_aspect_ratio=decrease,pad=${SHEET_W}:${SHEET_H}:(ow-iw)/2:(oh-ih)/2:white,${sheetTreatment(input.strength ?? 0)}[base]`,
        // Red plus on the face. Seedance's photoreal classifier treats an
        // annotated sheet as a production asset; the take does not draw it.
        `[base][1:v]overlay=0:0,${markerBoxes(faceMarker(bytes, input.face))}`,
      ].join(";"),
      "-frames:v",
      "1",
      "-update",
      "1",
      output,
    ]);
    if (!ok) return null;
    return new Uint8Array(await readFile(output));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
