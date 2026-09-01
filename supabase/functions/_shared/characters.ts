import { publicCharacter, type Service } from "./productions.ts";
import { stillKindLabel, stillRefEntries } from "./present.ts";
import { signAssetRows } from "./sign.ts";

type AssetRow = {
  id: string;
  kind: string;
  mime_type: string;
  storage_path: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export async function signCharacterPacks(supabase: Service, characters: Array<Record<string, unknown>>) {
  const actorIds = [...new Set(characters.map((character) => String(character.actor_id ?? "")).filter(Boolean))];
  const actorsRes = actorIds.length
    ? await supabase.from("actors").select("id, name, visual_reference_asset_ids").in("id", actorIds)
    : { data: [] as Array<{ id: string; name: string; visual_reference_asset_ids: Record<string, unknown> }>, error: null };
  const actors = actorsRes.error ? [] : actorsRes.data;
  const actorById = new Map((actors ?? []).map((row) => [String(row.id), row]));
  const merged = characters.map((character) => {
    const actor = actorById.get(String(character.actor_id ?? ""));
    const visual = { ...((character.visual_profile ?? {}) as Record<string, unknown>) };
    visual.visual_reference_asset_ids = {
      ...((actor?.visual_reference_asset_ids ?? {}) as Record<string, unknown>),
      ...((visual.visual_reference_asset_ids ?? {}) as Record<string, unknown>),
    };
    return { ...character, visual_profile: visual, actor_name: actor?.name ?? null };
  });
  const signed = new Map<string, { url: string; label: string }>();
  const ids = [
    ...new Set(
      merged.flatMap((character) => stillRefEntries(character.visual_profile as Record<string, unknown>).map((item) => item.id)),
    ),
  ];
  const seriesIds = [...new Set(merged.map((character) => String(character.series_id ?? "")).filter(Boolean))];
  const characterIds = new Set(merged.map((character) => String(character.id)));
  const { data: byId } = ids.length
    ? await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .in("id", ids)
        .is("deleted_at", null)
    : { data: [] };
  const { data: orphans } = seriesIds.length
    ? await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .in("series_id", seriesIds)
        .eq("kind", "character_reference")
        .is("deleted_at", null)
    : { data: [] };
  const actorAssetsRes = actorIds.length
    ? await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .in("actor_id", actorIds)
        .eq("kind", "character_reference")
        .is("deleted_at", null)
    : { data: [] as AssetRow[], error: null };
  const actorAssets = actorAssetsRes.error ? [] : actorAssetsRes.data;
  const rows = new Map<string, AssetRow>();
  for (const row of (byId ?? []) as AssetRow[]) rows.set(row.id, row);
  for (const row of (orphans ?? []) as AssetRow[]) {
    const characterId = String(row.metadata?.character_id ?? "");
    if (characterId && characterIds.has(characterId)) rows.set(row.id, row);
  }
  for (const row of (actorAssets ?? []) as AssetRow[]) rows.set(row.id, row);
  const signedRows = await signAssetRows([...rows.values()]);
  for (const row of signedRows) signed.set(row.id, { url: row.url, label: row.label });
  const orphanByCharacter = new Map<string, { url: string; label: string }>();
  for (const row of (orphans ?? []) as AssetRow[]) {
    const characterId = String(row.metadata?.character_id ?? "");
    const media = signed.get(row.id);
    if (characterId && media && !orphanByCharacter.has(characterId)) orphanByCharacter.set(characterId, media);
  }
  return { signed, orphanByCharacter, characters: merged };
}

export function presentPackedCharacter(
  row: Record<string, unknown>,
  signed: Map<string, { url: string; label: string }>,
  extras: Record<string, unknown> = {},
) {
  const visual = (row.visual_profile ?? {}) as Record<string, unknown>;
  const packed = stillRefEntries(visual).flatMap((item) => {
    const media = signed.get(item.id);
    return media ? [{ kind: item.kind, url: media.url, label: stillKindLabel(item.kind) }] : [];
  });
  const fallback = extras.fallback as { url: string; label: string } | undefined;
  if (packed.length === 0 && fallback) {
    packed.push({ kind: "front", url: fallback.url, label: stillKindLabel("front") });
  }
  const refs = packed.filter((item) => !item.kind.startsWith("look:"));
  const wardrobe = packed
    .filter((item) => item.kind.startsWith("look:"))
    .map((item) => ({ look: item.kind.slice(5), url: item.url, label: item.label }));
  return {
    ...publicCharacter(row),
    actor_id: (row.actor_id as string | null | undefined) ?? null,
    actor_name: (row.actor_name as string | null | undefined) ?? extras.actor_name ?? null,
    still_url: refs[0]?.url ?? packed[0]?.url ?? null,
    refs,
    wardrobe,
    ...Object.fromEntries(Object.entries(extras).filter(([key]) => key !== "fallback")),
  };
}
