import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENTS } from "./docs/index.ts";
import { isLegalIdentityComplete, LEGAL_ENTITY } from "./entity.ts";
import { COMPANY_PRIVACY_POLICY, FOOTER_LINKS } from "./policy.ts";

const FORBIDDEN = [
  /we never retain your content/i,
  /your data never leaves europe/i,
  /content is only shared with openrouter/i,
  /completely secure/i,
  /we are gdpr compliant/i,
  /we own your content/i,
  /automatically copyrighted/i,
  /all ai models run in the united states/i,
  /no third party ever stores/i,
  /we guarantee that (?:an )?output is unique/i,
];

function allText(): string {
  return LEGAL_DOCUMENTS.flatMap((doc) => [
    doc.summary,
    ...doc.sections.flatMap((section) =>
      section.blocks.flatMap((block) => {
        if (block.type === "p") return [block.text];
        if (block.type === "ul") return block.items;
        return [...block.headers, ...block.rows.flat()];
      }),
    ),
  ]).join("\n");
}

describe("legal claims match the product", () => {
  it("does not publish forbidden overclaims", () => {
    const text = allText();
    for (const pattern of FORBIDDEN) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it("states the company training and sale policy that engineering adopted", () => {
    expect(COMPANY_PRIVACY_POLICY.customer_project_training).toBe(false);
    expect(COMPANY_PRIVACY_POLICY.sell_customer_data).toBe(false);
    expect(COMPANY_PRIVACY_POLICY.strict_privacy_shipped).toBe(false);
    expect(allText()).toMatch(/do not sell your project content/i);
    expect(allText()).toMatch(/do not use private Project Content to train/i);
  });

  it("keeps legal identity unpublished until the placeholders are filled", () => {
    expect(isLegalIdentityComplete()).toBe(false);
    expect(LEGAL_ENTITY.legal_entity_name).toBe("");
  });

  it("exposes the eight footer pages", () => {
    expect(FOOTER_LINKS.map((link) => link.href)).toEqual([
      "/legal/privacy",
      "/legal/terms",
      "/legal/ai-processing",
      "/legal/acceptable-use",
      "/legal/cookies",
      "/legal/copyright",
      "/legal/dpa",
      "/security",
    ]);
  });
});
