import { describe, expect, it } from "vitest";
import { isPrivacyRefusal, screenCastLook, screenFaceReference } from "./face-screen.ts";
import type { Shot } from "../domain.ts";

const shot = { id: "shot-1" } as unknown as Shot;

describe("face screen", () => {
  it("reads the provider's privacy refusal", () => {
    expect(isPrivacyRefusal("HTTP 400 InputImageSensitiveContentDetected.PrivacyInformation: content[2]")).toBe(true);
    expect(isPrivacyRefusal("Duration 3s is not supported for this model")).toBe(false);
  });

  it("passes a face the provider accepts", async () => {
    const out = await screenFaceReference({
      video: { submit: async () => ({ upstream_job_id: "job-1", status: "queued" }) } as never,
      shot,
      model: "test/model",
      referenceUrl: "https://example.test/front.png",
    });
    expect(out.verdict).toBe("accepted");
  });

  it("separates a refused face from a broken request", async () => {
    const fails = (message: string) => ({ submit: async () => { throw new Error(message); } }) as never;
    const refused = await screenFaceReference({
      video: fails("openrouter /videos failed HTTP 400 InputImageSensitiveContentDetected.PrivacyInformation"),
      shot,
      model: "test/model",
      referenceUrl: "https://example.test/front.png",
    });
    const broken = await screenFaceReference({
      video: fails("openrouter /videos failed HTTP 500"),
      shot,
      model: "test/model",
      referenceUrl: "https://example.test/front.png",
    });
    expect(refused.verdict).toBe("refused");
    expect(broken.verdict).toBe("error");
  });

  it("rejects a far or plain NEW still and accepts FaceTime-close beauty", () => {
    expect(screenCastLook({ faceBox: { width: 0.08, height: 0.09 } }).pass).toBe(false);
    expect(screenCastLook({ faceBox: { width: 0.08, height: 0.09 } }).reasons).toContain("face_too_far");
    expect(screenCastLook({ notes: "average tired face", checkDistance: false }).reasons).toContain("face_plain");
    expect(screenCastLook({ beauty: false, checkDistance: false }).reasons).toContain("face_plain");
    expect(
      screenCastLook({ faceBox: { width: 0.42, height: 0.38 }, beauty: true, modest: true }).pass,
    ).toBe(true);
  });

  it("lets a faithful likeness stay when beauty is unknown, and still rejects immodest or far", () => {
    expect(screenCastLook({ beauty: null, notes: null, checkDistance: false }).pass).toBe(true);
    expect(screenCastLook({ beauty: null, modest: false, checkDistance: false }).reasons).toContain("modest_dress");
    expect(screenCastLook({ beauty: null, faceBox: { width: 0.08, height: 0.09 } }).reasons).toContain("face_too_far");
  });
});
