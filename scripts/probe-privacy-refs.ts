/**
 * Which reference still the provider's privacy classifier refuses.
 *
 * A scene take is submitted with several stills, and the refusal only names an
 * index ("content[2] may contain real person"), which is ambiguous once the
 * prompt shares the array. This submits one short clip per still on its own, so
 * the refusal points at a person instead of an index.
 *
 * A refused submit costs nothing. A submit that passes starts a short clip that
 * is never ingested, so keep the duration at the floor.
 *
 *   npx tsx scripts/probe-privacy-refs.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createOpenRouterVideo } = await import("../src/engine/ai/video.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { stampCharacterSheet } = await import("../src/engine/pipeline/character-sheet.ts");
const { shrinkReference } = await import("../src/engine/pipeline/identity-check.ts");
const { createOpenRouterVision } = await import("../src/engine/ai/vision.ts");
const { VIDEO_ROUTES } = await import("../src/engine/config/models.ts");

const STATE = resolve(process.cwd(), "assets/live/boss-delivery-v2/series.json");
const DURATION = 4;

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const video = createOpenRouterVideo();
const vision = createOpenRouterVision();

const shot = loaded.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => loaded.store.shotsFor(scene.id))[0];
if (!shot) throw new Error("No shot to borrow for the probe");

const names = process.argv.slice(2).map((row) => row.toUpperCase());
for (const name of names.length ? names : ["MARA", "COLE"]) {
  const character = loaded.store.charactersFor(state.series_id).find((row) => row.name.toUpperCase().startsWith(name));
  if (!character) continue;
  const actor = character.actor_id ? loaded.store.actors.get(character.actor_id) : undefined;
  const frontId = { ...(actor?.visual_reference_asset_ids ?? {}), ...character.visual_reference_asset_ids }.front;
  if (!frontId) continue;
  const source = await assets.get(frontId);
  if (!source) continue;
  const small = await shrinkReference(source.body);
  const face = await vision
    .locateFace!({ image: small?.bytes ?? source.body, imageMime: small?.mime ?? source.asset.mime_type })
    .catch(() => null);
  const stamped = (await stampCharacterSheet(source.body, { name: character.name, role: "front", face })) ?? source.body;
  const id = randomUUID();
  const stored = await assets.put({
    id,
    owner_id: source.asset.owner_id,
    series_id: state.series_id,
    kind: "character_reference",
    bucket: "private-character",
    storage_path: `private-character/${state.series_id}/${id}.png`,
    mime_type: "image/png",
    body: stamped,
    checksum: createHash("sha256").update(stamped).digest("hex"),
    metadata: { kind: "privacy_probe", name: character.name },
    created_at: new Date().toISOString(),
  });
  const signed = await assets.getSignedUrl(stored.id, 3600);
  try {
    const out = await video.submit({
      shot,
      prompt: `A fictional character stands still in an empty room and blinks once. ${character.name} only. No text.`,
      visual_reference_urls: [signed],
      audio_reference_url: null,
      duration_seconds: DURATION,
      model: VIDEO_ROUTES.dialogue_default.model,
      privacy_profile: "standard",
      callback_url: null,
    });
    process.stdout.write(`${character.name}: ACCEPTED (job ${out.upstream_job_id}) — this still is not the blocker\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refused = /InputImageSensitiveContentDetected|PrivacyInformation/i.test(message);
    process.stdout.write(`${character.name}: ${refused ? "REFUSED by the privacy classifier" : `error ${message.split("\n")[0]}`}\n`);
  }
}
