/**
 * Why the provider's privacy classifier refuses a scene take.
 *
 * The take is submitted with stamped "fictional character sheet" stills, not
 * raw portraits, precisely so the photoreal-face classifier reads them as
 * production assets. When a submit is refused down to the faces-only rung, one
 * of those sheets is still reading as a photo of a real person. This writes the
 * raw still and the stamped sheet for every character to disk so the stamp can
 * be looked at.
 *
 *   npx tsx scripts/probe-front-sheet.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { loadSeriesStore, hydrateAssetStore } = await import("../src/engine/store-postgres.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { stampCharacterSheet } = await import("../src/engine/pipeline/character-sheet.ts");
const { shrinkReference } = await import("../src/engine/pipeline/identity-check.ts");
const { createOpenRouterVision } = await import("../src/engine/ai/vision.ts");

const vision = createOpenRouterVision();

const OUT = resolve(process.cwd(), "assets/probe-sheet");
const STATE = resolve(process.cwd(), "assets/live/boss-delivery-v2/series.json");

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

await mkdir(OUT, { recursive: true });
const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);

for (const character of loaded.store.charactersFor(state.series_id)) {
  const actor = character.actor_id ? loaded.store.actors.get(character.actor_id) : undefined;
  const refs = { ...(actor?.visual_reference_asset_ids ?? {}), ...character.visual_reference_asset_ids };
  const frontId = refs.front;
  if (!frontId) {
    process.stdout.write(`${character.name}: no front still\n`);
    continue;
  }
  const source = await assets.get(frontId).catch(() => null);
  if (!source) {
    process.stdout.write(`${character.name}: front asset ${frontId} missing from storage\n`);
    continue;
  }
  const small = await shrinkReference(source.body);
  const face = await vision
    .locateFace!({ image: small?.bytes ?? source.body, imageMime: small?.mime ?? source.asset.mime_type })
    .catch(() => null);
  const stamped = await stampCharacterSheet(source.body, { name: character.name, role: "front", face });
  const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await writeFile(resolve(OUT, `${slug}-raw.png`), source.body);
  if (stamped) await writeFile(resolve(OUT, `${slug}-sheet.png`), stamped);
  process.stdout.write(
    `${character.name}: front ${frontId} raw ${source.body.byteLength}B stamped ${stamped ? `${stamped.byteLength}B` : "FAILED — raw still is sent as-is"}\n`,
  );
}
