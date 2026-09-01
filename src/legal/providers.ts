import { IMAGE_MODEL, TEXT_MODEL, VIDEO_ROUTES } from "../engine/config/models.ts";
import { COMPANY_PRIVACY_POLICY } from "./policy.ts";

export type RetentionClass =
  | "our_storage"
  | "gateway_no_logging_configured"
  | "endpoint_specific"
  | "zdr_if_verified"
  | "elevenlabs_account_settings";

export type ProviderRouteRecord = {
  model_id: string;
  upstream_provider: string;
  purpose: string;
  data_types: string[];
  retention_class: RetentionClass;
  training_allowed: boolean;
  headquarters: string;
  processing_region: string;
  processing_region_verified: boolean;
  evidence_url: string | null;
  approved_standard: boolean;
  approved_strict: boolean;
  reviewed_at: string;
  notes: string;
};

export type InfrastructureRecord = {
  id: string;
  name: string;
  purpose: string;
  data: string;
  location: string;
  retention: string;
  training: string;
};

export const REVIEWED_AT = "2026-08-30";

export const AI_PROVIDER_ROUTES: ProviderRouteRecord[] = [
  {
    model_id: TEXT_MODEL,
    upstream_provider: "openrouter",
    purpose: "Story bible, episode plan, and shot list",
    data_types: ["series title", "story idea", "prior bible JSON"],
    retention_class: "gateway_no_logging_configured",
    training_allowed: false,
    headquarters: "Anthropic via OpenRouter. Live endpoint geography is not separately confirmed here.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/anthropic/claude-sonnet-4.6",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "JSON completions only. No silent stock-script fallback.",
  },
  {
    model_id: IMAGE_MODEL,
    upstream_provider: "openrouter",
    purpose: "Locked fictional character stills",
    data_types: ["character description", "reference pose"],
    retention_class: "gateway_no_logging_configured",
    training_allowed: false,
    headquarters: "ByteDance Seedream via OpenRouter. Live endpoint geography is not separately confirmed here.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/bytedance-seed/seedream-4.5",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "9:16 character references. Fictional stills, or an account-owned face after recorded rights confirmation. Public-figure cloning is not offered.",
  },
  {
    model_id: VIDEO_ROUTES.dialogue_default.model,
    upstream_provider: "openrouter",
    purpose: "Dialogue and talking-head video",
    data_types: ["shot prompt", "character image references", "dialogue audio"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Model origin is ByteDance; OpenRouter is the gateway. Headquarters of the live endpoint is not separately confirmed here.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/alibaba/wan-3.0",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "Video jobs omit ZDR. Photoreal still accepted on 2026-08-30; identity held on a 15s shot. Audio-reference verified 2026-08-30 via alibaba_media passthrough: extracted soundtrack STT matched the locked ElevenLabs line. Seedance rejected the same still as a possible real person.",
  },
  {
    model_id: VIDEO_ROUTES.economy_default.model,
    upstream_provider: "openrouter",
    purpose: "Economy / silent / reaction video",
    data_types: ["shot prompt", "optional image references"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Model origin is ByteDance; live endpoint geography is not publicly confirmed.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/bytedance/seedance-2.0-mini",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "Video jobs omit ZDR. Default for reactions, B-roll, and establishing shots.",
  },
  {
    model_id: VIDEO_ROUTES.visual_default.model,
    upstream_provider: "openrouter",
    purpose: "Longer visual / establishing video",
    data_types: ["shot prompt", "optional image references"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Model origin is Alibaba; live endpoint geography is not publicly confirmed.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/alibaba/wan-3.0",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "Video jobs omit ZDR. Do not depend on audio-reference handling without a product test.",
  },
  {
    model_id: VIDEO_ROUTES.hero.model,
    upstream_provider: "openrouter",
    purpose: "Hero / complex-reference video experiment",
    data_types: ["shot prompt", "image and optional audio/video references"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Model origin is ByteDance; live endpoint geography is not publicly confirmed.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/bytedance/seedance-2.5",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "Video jobs omit ZDR. Audio-reference support is experimental until we measure it.",
  },
  {
    model_id: VIDEO_ROUTES.action.model,
    upstream_provider: "openrouter",
    purpose: "Action / slap peak video (single take, multi_shots off)",
    data_types: ["shot prompt", "optional image references"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Model origin is Kuaishou; live endpoint geography is not publicly confirmed.",
    processing_region: "Not publicly confirmed",
    processing_region_verified: false,
    evidence_url: "https://openrouter.ai/kwaivgi/kling-v3.0-std",
    approved_standard: true,
    approved_strict: false,
    reviewed_at: REVIEWED_AT,
    notes: "Video jobs omit ZDR. Routed only for slap/action peaks with multi_shots=false so the take stays a locked single.",
  },
  {
    model_id: VIDEO_ROUTES.privacy_fallback.model,
    upstream_provider: "google-vertex",
    purpose: "Documented-region video fallback (not shipped as a user Strict toggle)",
    data_types: ["shot prompt", "optional image references"],
    retention_class: "endpoint_specific",
    training_allowed: false,
    headquarters: "Google (Vertex). OpenRouter identifies Vertex as a U.S.-headquartered zero-retention provider.",
    processing_region: "Documented via Google Vertex / OpenRouter provider pinning. Confirm before any Strict launch.",
    processing_region_verified: true,
    evidence_url: "https://openrouter.ai/google/veo-3.1-lite",
    approved_standard: false,
    approved_strict: true,
    reviewed_at: REVIEWED_AT,
    notes: "No audio conditioning. SynthID watermarking. Not a silent fallback for dialogue shots. Strict UI is not shipped.",
  },
];

export const INFRASTRUCTURE_PROVIDERS: InfrastructureRecord[] = [
  {
    id: "supabase",
    name: "Supabase",
    purpose: "Authentication, Postgres, row-level authorization, project metadata, Edge Functions",
    data: "Account data, project metadata, job records, ledger, legal acceptances. Media bytes are intended for Cloudflare R2, not as the long-term public store.",
    location: "us-east-1 (North Virginia). This is the current project region — not a generic “US” or “EU” claim.",
    retention: "While the account or project exists, then under our deletion and backup lifecycle.",
    training: "Not an AI training vendor. Infrastructure processor.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    purpose: "Primary AI inference gateway for text, image, and video",
    data: "The minimum prompt and referenced assets required for a requested generation. OpenRouter transmits that input to the selected model provider.",
    location: "U.S. company. Onward model processing varies by endpoint and is not assumed to match our database region.",
    retention: "We configure content logging off and prefer ZDR and data_collection deny. Video jobs are not ZDR-eligible because the provider must temporarily retain output for download.",
    training: "OpenRouter documents that it does not train on inputs/outputs unless opted in. We do not opt in.",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    purpose: "Synthetic Voice Design, persistent character voices, dialogue TTS with timestamps, later SFX/music",
    data: "Voice-design descriptions, dialogue text, generated speech, alignment timestamps. Real-person voice samples are not collected in the current product.",
    location: "Standard customer data is stored in the U.S. Isolated residency is an Enterprise feature we have not enabled.",
    retention: "Account-level model-improvement opt-out is the required workspace setting. Zero Retention Mode is Enterprise-gated and not claimed as active.",
    training: "Configure “improve the models for everyone” off for our workspace. We do not claim this for every historical ElevenLabs feature.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    purpose: "Web hosting, R2 object storage, CDN for finished episodes, Containers for the media worker",
    data: "Site traffic, private media bytes, worker compute. Final episodes are served from private storage, not a public gallery.",
    location: "Global edge network. Object storage region will be stated here once the production R2 bucket region is fixed.",
    retention: "Per our asset retention policy (selected + last two candidates; failed after 7 days; intermediates after 30 days; soft-deleted series after 30 days).",
    training: "Not an AI training vendor.",
  },
  {
    id: "merchant",
    name: "Merchant of Record",
    purpose: "One-time project payments, tax, invoices, refunds, and chargebacks when designated",
    data: "Transaction and entitlement information needed to activate the Service. We do not store full payment-card numbers.",
    location: "Provider-specific. Not listed until the Merchant of Record contract is in place.",
    retention: "As required for accounting, tax, and the MoR’s own terms.",
    training: "Not an AI vendor. Role is payment / merchant-of-record provider until counsel classifies the relationship.",
  },
];

export function routeRecord(modelId: string): ProviderRouteRecord | undefined {
  return AI_PROVIDER_ROUTES.find((row) => row.model_id === modelId);
}

export function publicModelRows(): ProviderRouteRecord[] {
  return AI_PROVIDER_ROUTES.filter((row) => row.approved_standard || row.approved_strict);
}

export function findStrictRoute(): ProviderRouteRecord | undefined {
  return AI_PROVIDER_ROUTES.find(
    (row) =>
      row.approved_strict &&
      row.processing_region_verified &&
      row.training_allowed === false,
  );
}

export function assertStrictAvailable(): ProviderRouteRecord {
  if (COMPANY_PRIVACY_POLICY.strict_privacy_shipped) {
    const route = findStrictRoute();
    if (!route) {
      throw new PrivacyRouteUnavailableError();
    }
    return route;
  }
  throw new PrivacyRouteUnavailableError();
}

export class PrivacyRouteUnavailableError extends Error {
  constructor() {
    super(
      "This generation is temporarily unavailable under your privacy setting. Try again later or change the privacy setting.",
    );
    this.name = "PrivacyRouteUnavailableError";
  }
}

export function generationPrivacyLog(input: {
  model: string;
  privacy_profile: "standard";
}): {
  model: string;
  upstream_provider: string;
  privacy_profile: "standard";
  zdr_requested: boolean;
  data_collection_setting: "deny";
  processing_region_class: string;
} {
  const row = routeRecord(input.model);
  return {
    model: input.model,
    upstream_provider: row?.upstream_provider ?? "unknown",
    privacy_profile: input.privacy_profile,
    zdr_requested: Object.values(VIDEO_ROUTES).some((route) => route.model === input.model)
      ? false
      : COMPANY_PRIVACY_POLICY.zdr_when_available,
    data_collection_setting: "deny",
    processing_region_class: row?.processing_region_verified
      ? "documented"
      : "not_publicly_confirmed",
  };
}

export function retentionLabel(value: RetentionClass): string {
  switch (value) {
    case "our_storage":
      return "Stored by us";
    case "gateway_no_logging_configured":
      return "Gateway logging off (configured)";
    case "endpoint_specific":
      return "Endpoint-specific";
    case "zdr_if_verified":
      return "ZDR requested where the route supports it; not verified for every video job";
    case "elevenlabs_account_settings":
      return "Account settings / Enterprise features as configured";
  }
}
