import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import { displayField, LEGAL_ENTITY } from "../entity.ts";
import type { LegalDocument } from "../document.ts";

export const securityDocument: LegalDocument = {
  slug: "security",
  title: "Security",
  version: DOCUMENT_VERSIONS.security,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "A trust page, not a contract. It lists controls that exist in the current codebase, not controls we hope to add.",
  sections: [
    {
      id: "true",
      title: "What is true today",
      blocks: [
        {
          type: "ul",
          items: [
            "Projects are private by default. There is no public gallery.",
            "TLS in transit for the web app and provider calls.",
            "Supabase Row Level Security is enabled and forced on project tables. Users see their own series, characters, episodes, jobs, and asset metadata.",
            "Provider API keys and the Supabase service role stay on the server. They are not shipped to the browser.",
            "Media paths are private. Signed URLs are minted per job with a TTL meant to outlive provider queue time.",
            "Generation uses an approved provider registry. Arbitrary OpenRouter catalog models are not offered.",
            "We do not use private Project Content to train our own public models.",
            "Gateway settings request ZDR and deny data collection where the route supports those flags. Video download still requires temporary provider retention.",
            "Application logs are designed to hold job, model, cost, status, and error codes — not full scripts, audio, or signed URLs.",
            "A reconciliation sweeper exists so a dropped webhook cannot leave a job hanging forever.",
          ],
        },
      ],
    },
    {
      id: "not-yet",
      title: "What this page does not claim",
      blocks: [
        {
          type: "ul",
          items: [
            "Absolute security.",
            "SOC 2, ISO, or other certifications we have not completed.",
            "That every AI endpoint’s physical region is known.",
            "That account deletion and provider-side voice deletion are already a finished production workflow.",
            "That support access is already time-boxed with a full admin audit UI. The policy is written; the admin product is not.",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          type: "p",
          text: `Security: ${displayField(LEGAL_ENTITY.security_email, "security@[domain]")}.`,
        },
      ],
    },
  ],
};
