import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import {
  AI_PROVIDER_ROUTES,
  INFRASTRUCTURE_PROVIDERS,
  retentionLabel,
} from "../providers.ts";
import type { LegalDocument } from "../document.ts";

const modelRows = AI_PROVIDER_ROUTES.map((row) => [
  row.model_id,
  row.upstream_provider,
  row.purpose,
  retentionLabel(row.retention_class),
  row.training_allowed ? "Allowed" : "Not allowed by our policy / routing settings",
  row.processing_region_verified
    ? row.processing_region
    : "Not publicly confirmed",
]);

const infraRows = INFRASTRUCTURE_PROVIDERS.map((row) => [
  row.name,
  row.purpose,
  row.location,
  row.retention,
]);

export const aiProcessingDocument: LegalDocument = {
  slug: "ai-processing",
  title: "AI Processing & Subprocessors",
  version: DOCUMENT_VERSIONS.ai_processing,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "Your project is stored by us. When you request an AI operation, we send only the information needed for that operation to an approved AI processor. OpenRouter is the primary gateway and forwards that input to the selected model provider. ElevenLabs is used directly for synthetic voices. This page is generated from the same provider registry the product uses to route jobs.",
  sections: [
    {
      id: "how",
      title: "How AI processing works",
      blocks: [
        {
          type: "p",
          text: "Permanent project memory lives in our systems. AI vendors are used as transient processors whenever that is technically possible. A typical path is: our app → private project storage → the minimum necessary asset → OpenRouter or another approved processor → the approved model endpoint → the result is copied back into our storage.",
        },
        {
          type: "p",
          text: "We do not say that content is shared only with OpenRouter. OpenRouter transmits inputs to the selected model provider. We do not say that AI providers never train on your data unless the specific route enforces that. We do not name a country for an endpoint whose physical region is unverified.",
        },
      ],
    },
    {
      id: "gateway",
      title: "Primary AI gateway — OpenRouter",
      blocks: [
        {
          type: "p",
          text: "Purpose: route text, image, and video inference. Data: the prompt and referenced assets required for that job. Retention: we turn content logging off and prefer ZDR and data_collection deny. Video jobs still require temporary provider retention so we can download the file. Training: we do not opt in to OpenRouter using inputs or outputs for product improvement. Location: U.S. company; onward processing varies.",
        },
      ],
    },
    {
      id: "direct",
      title: "Direct AI processors — ElevenLabs",
      blocks: [
        {
          type: "p",
          text: "Purpose: Voice Design, persistent fictional character voices, dialogue speech with caption-grade timestamps. Data: a natural-language voice description, the line, and the resulting audio. We do not send real-person voice recordings. Location: standard U.S. storage. Isolated EU residency and Zero Retention Mode are Enterprise features and are not claimed as active. Training: our workspace is required to disable model-improvement on new submitted data.",
        },
      ],
    },
    {
      id: "models",
      title: "Model providers via OpenRouter",
      blocks: [
        {
          type: "p",
          text: "This table is the live approved registry, not a marketing list of every model on OpenRouter. Unknown physical regions are labeled as not publicly confirmed. Seedance is not described as “China” or “United States” processing unless that is verified.",
        },
        {
          type: "table",
          headers: [
            "Model",
            "Provider",
            "Purpose",
            "Retention",
            "Training",
            "Processing region",
          ],
          rows: modelRows,
        },
      ],
    },
    {
      id: "infra",
      title: "Infrastructure and payments",
      blocks: [
        {
          type: "table",
          headers: ["Provider", "Purpose", "Location / residency", "Retention"],
          rows: infraRows,
        },
      ],
    },
    {
      id: "likeness",
      title: "Uploaded face references",
      blocks: [
        {
          type: "p",
          text: "If you upload a face photo for an actor pack, that image is stored in private character storage on your account and sent to the approved image route as a reference. Generation starts only after a stored likeness-rights confirmation. Named public figures remain blocked. Voice cloning from an uploaded recording is not offered.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes to this list",
      blocks: [
        {
          type: "p",
          text: "The Privacy Policy stays stable. This page changes when routes change. Business customers may request subprocessor notice at the legal contact once that inbox is live. A material new processor may require advance notice under an applicable DPA. Counsel sets the notice period.",
        },
      ],
    },
  ],
};
