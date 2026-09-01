import { describe, expect, it } from "vitest";
import { cuCropBox, firstFrameKind, firstFrameQc } from "./face-crop.ts";

describe("face-crop", () => {
  it("crops a full-body 9:16 plate to a head-and-shoulders window", () => {
    const box = cuCropBox(720, 1280, "full_body");
    expect(box.y).toBeLessThan(80);
    expect(box.height).toBeLessThan(1280 * 0.35);
    expect(box.height / box.width).toBeGreaterThan(1.5);
  });

  it("keeps a tighter window on an already-face still", () => {
    const face = cuCropBox(720, 900, "front");
    const body = cuCropBox(720, 1280, "full_body");
    expect(face.y).toBeGreaterThan(body.y);
    expect(face.height / 900).toBeGreaterThan(body.height / 1280);
  });

  it("classifies first_frame kinds", () => {
    expect(firstFrameKind("cu")).toBe("cu");
    expect(firstFrameKind("front")).toBe("face");
    expect(firstFrameKind("three_quarter")).toBe("face");
    expect(firstFrameKind("full_body")).toBe("full_body");
    expect(firstFrameKind("object_insert")).toBe("object");
    expect(firstFrameKind("phone_ui")).toBe("object");
    expect(firstFrameKind("default_wardrobe")).toBe("wardrobe");
  });

  it("flags a full-body first_frame on a CU function and a face still on an insert", () => {
    expect(
      firstFrameQc({ shotFunction: "button_cu", firstFrameKind: "full_body" }),
    ).toEqual({ ok: false, reason: "first_frame_not_cu" });
    expect(
      firstFrameQc({ shotFunction: "button_cu", firstFrameKind: "cu" }),
    ).toEqual({ ok: true, reason: null });
    expect(
      firstFrameQc({ shotFunction: "phone_ui", firstFrameKind: "face", objectInsert: true }),
    ).toEqual({ ok: false, reason: "insert_used_face_still" });
    expect(
      firstFrameQc({ shotFunction: "phone_ui", firstFrameKind: "object", objectInsert: true }),
    ).toEqual({ ok: true, reason: null });
    expect(
      firstFrameQc({
        shotFunction: "button_cu",
        firstFrameKind: "full_body",
        policy: "wardrobe_first",
      }),
    ).toEqual({ ok: true, reason: null });
  });
});
