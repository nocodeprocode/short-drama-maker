import { describe, expect, it } from "vitest";
import { VIDEO_ROUTES } from "../engine/config/models.ts";
import { aiProcessingDocument } from "./docs/ai-processing.ts";
import {
  AI_PROVIDER_ROUTES,
  assertStrictAvailable,
  generationPrivacyLog,
  PrivacyRouteUnavailableError,
  publicModelRows,
} from "./providers.ts";

describe("provider registry", () => {
  it("covers every routed video model", () => {
    const ids = new Set(AI_PROVIDER_ROUTES.map((row) => row.model_id));
    for (const route of Object.values(VIDEO_ROUTES)) {
      expect(ids.has(route.model)).toBe(true);
    }
  });

  it("drives the public AI Processing table", () => {
    const table = aiProcessingDocument.sections
      .find((section) => section.id === "models")
      ?.blocks.find((block) => block.type === "table");
    expect(table && table.type === "table" ? table.rows.length : 0).toBe(
      publicModelRows().length,
    );
    expect(JSON.stringify(aiProcessingDocument)).toContain("Not publicly confirmed");
    for (const row of publicModelRows()) {
      if (!row.processing_region_verified) {
        expect(row.processing_region).toBe("Not publicly confirmed");
        expect(row.processing_region).not.toMatch(/China|United States/i);
      }
    }
  });

  it("fails closed when Strict is requested", () => {
    expect(() => assertStrictAvailable()).toThrow(PrivacyRouteUnavailableError);
  });

  it("records a generation privacy log without the prompt", () => {
    const log = generationPrivacyLog({
      model: VIDEO_ROUTES.dialogue_default.model,
      privacy_profile: "standard",
    });
    expect(log.zdr_requested).toBe(false);
    expect(log.data_collection_setting).toBe("deny");
    expect(log.processing_region_class).toBe("not_publicly_confirmed");
    expect(log).not.toHaveProperty("prompt");
  });
});
