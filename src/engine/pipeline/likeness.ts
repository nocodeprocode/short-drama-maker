export const LIKENESS_RIGHTS_VERSION = "2026-08-31";

export function likenessGate(confirmed: boolean): { ok: true } | { ok: false; status: 403; error: string } {
  if (!confirmed) {
    return { ok: false, status: 403, error: "Likeness rights confirmation is required." };
  }
  return { ok: true };
}

export function actorsFromPackedCharacters(
  rows: Array<{
    id: string;
    name: string;
    owner_id: string;
    actor_id?: string | null;
    visual_reference_asset_ids?: Record<string, string> | null;
  }>,
): Array<{ character_id: string; owner_id: string; name: string; refs: Record<string, string> }> {
  return rows.flatMap((row) => {
    if (row.actor_id) return [];
    const refs = Object.fromEntries(
      Object.entries(row.visual_reference_asset_ids ?? {}).filter(([, id]) => Boolean(id)),
    );
    if (Object.keys(refs).length === 0) return [];
    return [{ character_id: row.id, owner_id: row.owner_id, name: row.name, refs }];
  });
}
