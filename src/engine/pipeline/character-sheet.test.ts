import { describe, expect, it } from "vitest";
import { characterSheetLabel, faceMarker } from "./character-sheet.ts";

/** A PNG header is all faceMarker reads: width and height at bytes 16 and 20. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("character sheet stamp", () => {
  it("labels the angle of each still", () => {
    expect(characterSheetLabel("Cole", "front")).toBe("COLE FRONT");
    expect(characterSheetLabel("Mara Voss", "profile")).toBe("MARA VOSS SIDE");
    expect(characterSheetLabel("Mara", "wardrobe")).toBe("MARA WARDROBE");
  });

  it("puts the marker on the face of a full-body plate, not where a portrait's head would be", () => {
    // A tall plate scales to the full 1280 height with side padding.
    const plate = pngHeader(1024, 1820);
    const head = faceMarker(plate, { x: 0.44, y: 0.06, width: 0.12, height: 0.09 });
    expect(head.y).toBeGreaterThan(120);
    expect(head.y).toBeLessThan(200);
    expect(head.x).toBeGreaterThan(300);
    expect(head.x).toBeLessThan(420);
    // Without a box it falls back to the portrait position, which is far lower.
    expect(faceMarker(plate).y).toBe(358);
  });

  it("keeps the marker inside the sheet when the face sits at an edge", () => {
    const plate = pngHeader(720, 1280);
    const corner = faceMarker(plate, { x: 0, y: 0, width: 0.04, height: 0.04 });
    expect(corner.x).toBeGreaterThanOrEqual(corner.barWidth / 2);
    expect(corner.y).toBeGreaterThanOrEqual(corner.barWidth / 2);
  });

  it("sizes the bar to cover the eye line of the located face", () => {
    const plate = pngHeader(1024, 1820);
    const marker = faceMarker(plate, { x: 0.4, y: 0.2, width: 0.2, height: 0.16 });
    // Wider than the head so the eyes cannot sit beside the bar, and tall
    // enough that a mislocated box by a few percent still covers them.
    const headWidth = 0.2 * (1024 * (1280 / 1820));
    expect(marker.barWidth).toBeGreaterThan(headWidth);
    expect(marker.barHeight).toBeGreaterThan(30);
  });
});
