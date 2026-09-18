export const LIKENESS_RIGHTS_VERSION = "2026-08-31";

/** Unique key on legal_acceptances: one row per user, document, and version. */
export const LEGAL_ACCEPTANCE_CONFLICT = "user_id,document_type,version";

export function likenessGate(confirmed: boolean): { ok: true } | { ok: false; status: 403; error: string } {
  if (!confirmed) {
    return { ok: false, status: 403, error: "Likeness rights confirmation is required." };
  }
  return { ok: true };
}

export function likenessAcceptanceRow(userId: string) {
  return {
    user_id: userId,
    document_type: "likeness_rights",
    version: LIKENESS_RIGHTS_VERSION,
    context: "actor_upload",
    accepted_at: new Date().toISOString(),
  };
}

/** Replacing a photo re-confirms the same document version. That is not an error. */
export function acceptanceWriteError(message?: string | null): string | null {
  if (!message) return null;
  if (/legal_acceptances_user_doc_version_uidx|duplicate key value violates unique constraint/i.test(message)) {
    return null;
  }
  return message;
}
