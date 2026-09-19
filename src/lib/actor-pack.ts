/**
 * The four angles a face pack is meant to hold, in the order they are built.
 *
 * The page used to render only the stills that exist, so a pack that failed
 * halfway showed two tiles and no way to finish: the only button left rebuilt
 * all four and charged for the two that were already good.
 */
export const FACE_PACK_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "front", label: "Front" },
  { kind: "three_quarter", label: "Three-quarter" },
  { kind: "profile", label: "Profile" },
  { kind: "full_body", label: "Full body" },
];

export type PackTile = { kind: string; label: string; url: string | null };

/** Every slot of the pack, with the stills that landed and the holes that did not. */
export function packTiles(refs: ReadonlyArray<{ kind: string; url: string; label: string }> | null | undefined): PackTile[] {
  const rows = refs ?? [];
  const byKind = new Map(rows.map((ref) => [ref.kind, ref]));
  const canonical = FACE_PACK_KINDS.map(({ kind, label }) => {
    const hit = byKind.get(kind);
    return { kind, label: hit?.label || label, url: hit?.url || null };
  });
  // Wardrobe looks and one-off kinds keep their place after the four angles.
  const extra = rows
    .filter((ref) => !FACE_PACK_KINDS.some((item) => item.kind === ref.kind))
    .map((ref) => ({ kind: ref.kind, label: ref.label, url: ref.url || null }));
  return [...canonical, ...extra];
}

/** True when the pack has a hole a redo could fill. */
export function packHasGap(refs: ReadonlyArray<{ kind: string; url: string; label: string }> | null | undefined): boolean {
  return packTiles(refs).some((tile) => !tile.url);
}
