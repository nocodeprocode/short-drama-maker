export const LIKENESS_RIGHTS_VERSION = "2026-08-31";

export function likenessGate(confirmed: boolean): { ok: true } | { ok: false; status: 403; error: string } {
  if (!confirmed) {
    return { ok: false, status: 403, error: "Likeness rights confirmation is required." };
  }
  return { ok: true };
}
