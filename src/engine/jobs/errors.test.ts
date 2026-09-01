import { describe, expect, it } from "vitest";
import { classifyTaskFailure, isCopyrightFailure, redactTaskError, sanitizeTaskError } from "./errors.ts";

describe("task failure classification", () => {
  it("treats unique constraint collisions as transient, not quality", () => {
    expect(
      classifyTaskFailure('duplicate key value violates unique constraint "generation_jobs_idempotency_key_key"'),
    ).toBe("transient");
    expect(sanitizeTaskError('duplicate key value violates unique constraint "generation_jobs_idempotency_key_key"')).not.toMatch(
      /generation_jobs|constraint/,
    );
  });

  it("keeps the OpenRouter HTTP status in the user-facing error", () => {
    expect(
      sanitizeTaskError('OpenRouter /images failed HTTP 400: {"error":{"message":"bad request"}}'),
    ).toMatch(/HTTP 400/);
  });

  it("treats dropped fetches as transient", () => {
    expect(classifyTaskFailure("fetch failed")).toBe("transient");
    expect(sanitizeTaskError("fetch failed")).toMatch(/retrying/i);
  });

  it("detects provider copyright rejects", () => {
    expect(
      isCopyrightFailure(
        "The request failed because the output video may be related to copyright restrictions.",
      ),
    ).toBe(true);
    expect(isCopyrightFailure("fetch failed")).toBe(false);
  });

  it("keeps policy and quality distinct", () => {
    expect(classifyTaskFailure("This is not allowed for a real person likeness")).toBe("policy");
    expect(classifyTaskFailure("below the quality bar")).toBe("quality");
  });

  it("treats provider input-image privacy rejects as technical, not policy", () => {
    const live =
      'OpenRouter /videos failed HTTP 400: {"error":{"message":"HTTP 400: {\\"error\\":{\\"code\\":\\"InputImageSensitiveContentDetected.PrivacyInformation\\",\\"message\\":\\"The request failed because the input image \'content[1]\' may contain real person.\\"}}"}}';
    expect(classifyTaskFailure(live)).toBe("technical");
    expect(sanitizeTaskError(live)).toBe("A reference frame was rejected. We are retrying this step.");
    expect(sanitizeTaskError(live)).not.toMatch(/edit the scene|OpenRouter|PrivacyInformation/i);
  });

  it("redacts secrets but keeps the real failure reason", () => {
    expect(
      redactTaskError("ElevenLabs /v1/text-to-voice failed HTTP 400: generated_voice_id expired bearer sk-live-abcdefghij"),
    ).toMatch(/HTTP 400.*generated_voice_id expired/);
    expect(redactTaskError("ElevenLabs /v1/text-to-voice failed HTTP 400: bearer sk-live-abcdefghij")).not.toMatch(
      /sk-live|bearer sk/i,
    );
    expect(sanitizeTaskError("Media store GET failed HTTP 403 for voice_preview abc")).toMatch(/HTTP 403/);
  });
});
