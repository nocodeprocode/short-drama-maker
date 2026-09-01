import type { Service } from "./productions.ts";
import { stillKindLabel, stillRefEntries } from "./present.ts";
import { signAssetRows } from "./sign.ts";

export async function signActorPacks(supabase: Service, actors: Array<Record<string, unknown>>) {
  const ids = [
    ...new Set(
      actors.flatMap((actor) =>
        stillRefEntries({ visual_reference_asset_ids: actor.visual_reference_asset_ids as Record<string, unknown> }).map(
          (item) => item.id,
        ),
      ),
    ),
  ];
  const actorIds = actors.map((actor) => String(actor.id));
  const { data: byId } = ids.length
    ? await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .in("id", ids)
        .is("deleted_at", null)
    : { data: [] };
  const { data: extras } = actorIds.length
    ? await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .in("actor_id", actorIds)
        .eq("kind", "character_reference")
        .is("deleted_at", null)
    : { data: [] };
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of [...(byId ?? []), ...(extras ?? [])]) rows.set(String(row.id), row);
  const signed = new Map<string, { url: string; label: string }>();
  for (const row of await signAssetRows([...rows.values()] as Array<{
    id: string;
    kind: string;
    mime_type: string;
    storage_path: string;
    metadata?: Record<string, unknown>;
    created_at: string;
  }>)) {
    signed.set(row.id, { url: row.url, label: row.label });
  }
  return signed;
}

export function presentActor(row: Record<string, unknown>, signed: Map<string, { url: string; label: string }>) {
  const refs = stillRefEntries({
    visual_reference_asset_ids: row.visual_reference_asset_ids as Record<string, unknown>,
  }).flatMap((item) => {
    const media = signed.get(item.id);
    return media ? [{ kind: item.kind, url: media.url, label: stillKindLabel(item.kind) }] : [];
  });
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    still_url: refs[0]?.url ?? null,
    refs,
    created_at: row.created_at,
  };
}

export async function firstOwnedSeriesId(supabase: Service, ownerId: string, isAdmin: boolean) {
  let query = supabase.from("series").select("id").is("deleted_at", null).limit(1);
  if (!isAdmin) query = query.eq("owner_id", ownerId);
  else query = query.eq("owner_id", ownerId);
  const { data } = await query.maybeSingle();
  return data?.id ? String(data.id) : null;
}
