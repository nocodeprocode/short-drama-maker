import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import type { LegalDocument } from "../document.ts";

export const dataResidencyDocument: LegalDocument = {
  slug: "data-residency",
  title: "Data Residency & AI Privacy",
  version: DOCUMENT_VERSIONS.data_residency,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "AI inference location can differ from primary project-storage location. A Frankfurt or Virginia database does not mean Seedance runs in that region.",
  sections: [
    {
      id: "table",
      title: "Where things live",
      blocks: [
        {
          type: "table",
          headers: ["Data", "Primary storage", "Processing"],
          rows: [
            [
              "Account and database",
              "Supabase us-east-1 (North Virginia)",
              "Supabase and necessary infrastructure",
            ],
            [
              "Project assets",
              "Intended: Cloudflare R2 (bucket region to be stated when production buckets are created)",
              "Our storage and CDN for finished episodes",
            ],
            [
              "AI text / image / video",
              "Not permanent primary storage at the model vendor",
              "Approved AI model endpoint. Region is endpoint-specific and often unconfirmed",
            ],
            [
              "Voice Design and dialogue speech",
              "Canonical audio in our storage; ElevenLabs holds the persistent voice_id",
              "ElevenLabs standard U.S. environment",
            ],
            [
              "Billing",
              "Merchant of Record once designated",
              "MoR infrastructure",
            ],
          ],
        },
        {
          type: "p",
          text: "Standard privacy is the only shipped profile. Strict regional processing is fail-closed and not exposed in the product until a route is both region-documented and compatible with dialogue-first video.",
        },
      ],
    },
  ],
};
