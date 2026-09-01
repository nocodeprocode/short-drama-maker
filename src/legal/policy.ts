export const COMPANY_PRIVACY_POLICY = {
  customer_project_training: false,
  sell_customer_data: false,
  public_by_default: false,
  provider_content_logging: false,
  zdr_when_available: true,
  minimum_necessary_payload: true,
  voice_design_default: true,
  real_person_cloning_supported: false,
  celebrity_cloning_supported: false,
  age_minimum: 18,
  cookies: "essential_only" as const,
  privacy_profiles_shipped: ["standard"] as const,
  strict_privacy_shipped: false,
} as const;

export const DOCUMENT_DATES = {
  effective: "2026-08-30",
  updated: "2026-08-31",
};

export const LIKENESS_RIGHTS_VERSION = "2026-08-31";

export const DOCUMENT_VERSIONS = {
  terms: "2026-08-30",
  privacy: "2026-08-30",
  ai_processing: "2026-08-30",
  acceptable_use: "2026-08-30",
  cookies: "2026-08-30",
  copyright: "2026-08-30",
  dpa: "2026-08-30",
  security: "2026-08-30",
  data_residency: "2026-08-30",
  voice_consent: "1",
} as const;

export type DocumentType = keyof typeof DOCUMENT_VERSIONS;

export const FOOTER_LINKS = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/ai-processing", label: "AI & Subprocessors" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/copyright", label: "Copyright" },
  { href: "/legal/dpa", label: "DPA" },
  { href: "/security", label: "Security" },
] as const;
