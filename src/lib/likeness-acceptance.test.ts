import { describe, expect, it } from "vitest";
import {
  LEGAL_ACCEPTANCE_CONFLICT,
  LIKENESS_RIGHTS_VERSION,
  acceptanceWriteError,
  likenessAcceptanceRow,
} from "../../supabase/functions/_shared/likeness.ts";

describe("likeness acceptance writes", () => {
  it("keys a confirmation on the unique legal row", () => {
    const row = likenessAcceptanceRow("user-1");
    expect(row).toMatchObject({
      user_id: "user-1",
      document_type: "likeness_rights",
      version: LIKENESS_RIGHTS_VERSION,
      context: "actor_upload",
    });
    expect(LEGAL_ACCEPTANCE_CONFLICT).toBe("user_id,document_type,version");
  });

  it("does not fail a second confirmation of the same version", () => {
    expect(
      acceptanceWriteError(
        'duplicate key value violates unique constraint "legal_acceptances_user_doc_version_uidx"',
      ),
    ).toBeNull();
    expect(acceptanceWriteError("Could not save the photo")).toBe("Could not save the photo");
  });
});
