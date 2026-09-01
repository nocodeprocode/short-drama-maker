import { DOCUMENT_VERSIONS, type DocumentType } from "./policy.ts";

export type LegalAcceptance = {
  id: string;
  user_id: string;
  document_type: DocumentType | "voice_rights" | "likeness_rights" | "marketing_consent";
  version: string;
  accepted_at: string;
  context: string;
  session_id: string | null;
  ip_reference: string | null;
  user_agent_summary: string | null;
};

export type PrivacyRequestType =
  | "access"
  | "download"
  | "correct"
  | "delete_account"
  | "object"
  | "withdraw_consent"
  | "marketing_opt_out"
  | "portability";

export type PrivacyRequestStatus =
  | "received"
  | "identity_verification"
  | "processing"
  | "completed"
  | "denied_with_reason";

export type PrivacyRequest = {
  id: string;
  user_id: string | null;
  email: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  requested_at: string;
  identity_verified_at: string | null;
  completed_at: string | null;
  notes_internal: string;
};

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  action: string;
  series_id: string | null;
  reason: string | null;
  created_at: string;
};

export function currentVersion(type: DocumentType): string {
  return DOCUMENT_VERSIONS[type];
}

export const PRIVACY_REQUEST_TYPES: { type: PrivacyRequestType; label: string }[] = [
  { type: "access", label: "Access my data" },
  { type: "download", label: "Download my data" },
  { type: "correct", label: "Correct my data" },
  { type: "delete_account", label: "Delete my account" },
  { type: "object", label: "Object or restrict processing" },
  { type: "withdraw_consent", label: "Withdraw consent" },
  { type: "marketing_opt_out", label: "Marketing opt-out" },
  { type: "portability", label: "Data portability" },
];
