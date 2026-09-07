import { describe, expect, it } from "vitest";
import { isPrivacyRefusal, screenFaceReference } from "./face-screen.ts";
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
});
