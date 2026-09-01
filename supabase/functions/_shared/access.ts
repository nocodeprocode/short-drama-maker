export type AccessRole = "admin" | "user";

export type Access = {
  role: AccessRole;
  beta: boolean;
  isAdmin: boolean;
  allowed: boolean;
};

export function accessFromAppMetadata(metadata: Record<string, unknown> | undefined): Access {
  const role: AccessRole = metadata?.role === "admin" ? "admin" : "user";
  const beta = metadata?.beta === true;
  return {
    role,
    beta,
    isAdmin: role === "admin",
    allowed: role === "admin" || beta,
  };
}

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
