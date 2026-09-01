import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import { displayField, LEGAL_ENTITY, operatorLine } from "../entity.ts";
import type { LegalDocument } from "../document.ts";

export const dpaDocument: LegalDocument = {
  slug: "dpa",
  title: "Data Processing Addendum",
  version: DOCUMENT_VERSIONS.dpa,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "For studios and agencies that upload other people’s personal data. This is a self-serve draft of the topics a DPA must cover, including AI inference providers. It is not an executed contract until the legal entity is completed and counsel issues the signing version.",
  counsel_note:
    "Counsel must confirm the processor and subprocessor structure for each approved provider. Do not treat every OpenRouter model vendor as a legal subprocessor of OpenRouter without that review.",
  sections: [
    {
      id: "roles",
      title: "Roles",
      blocks: [
        { type: "p", text: operatorLine() },
        {
          type: "p",
          text: "For consumer accounts we generally act as controller of account, billing, security, and service-usage data. When a business customer uploads actors’ images or other third-party personal data, that customer is the controller and we are the processor. Supabase, OpenRouter, ElevenLabs, model providers, and Cloudflare then act as our processors or onward processors, subject to the contractual chain counsel confirms.",
        },
      ],
    },
    {
      id: "ai",
      title: "AI-specific processing",
      blocks: [
        {
          type: "p",
          text: "The Service may use AI inference providers to perform requested processing, including text, image, audio, and video inputs. Those providers are listed on /legal/ai-processing. They are not hidden under “cloud infrastructure.”",
        },
      ],
    },
    {
      id: "topics",
      title: "What the executed DPA will cover",
      blocks: [
        {
          type: "ul",
          items: [
            "Processing instructions and confidentiality.",
            "Security measures actually in use.",
            "The current subprocessor / AI-processor registry and how material additions are notified.",
            "International transfers and SCCs where required.",
            "Assistance with data-subject requests and breaches.",
            "Deletion or return at the end of the engagement.",
            "Audit information appropriate to the relationship.",
          ],
        },
        {
          type: "p",
          text: `Contact ${displayField(LEGAL_ENTITY.legal_email, "[LEGAL_EMAIL]")} to request the signing copy once the entity is in place. We review vendor DPAs from Supabase and OpenRouter as part of due diligence; those documents are not a substitute for ours.`,
        },
      ],
    },
  ],
};
