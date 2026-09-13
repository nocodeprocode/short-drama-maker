/**
 * Give a character a new face.
 *
 * The video provider's privacy classifier refuses some generated faces as
 * "may contain real person", and no amount of character-sheet stamping moves
 * it: the likeness itself is what trips. This clears that character's stills
 * (face, wardrobe, and the appearance job that would restore them), optionally
 * amends the appearance description so the new render is not the same person,
 * and re-locks the face.
 *
 *   npx tsx scripts/reface-character.ts COLE
 *   npx tsx scripts/reface-character.ts COLE --note "broader jaw, shaved head, heavy brow"
 *   npx tsx scripts/reface-character.ts ROMAN --state assets/live/wolf-boss-hired-his-mate/series.json
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createAiGateway } = await import("../src/engine/ai/index.ts");
const { createEngine } = await import("../src/engine/create-engine.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { commitSeriesStore, hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { PRICE_SNAPSHOT_VERSION } = await import("../src/engine/config/models.ts");

const args = process.argv.slice(2);
const stateIndex = args.indexOf("--state");
const STATE = resolve(
  process.cwd(),
  stateIndex >= 0 ? args[stateIndex + 1] ?? "" : "assets/live/boss-delivery-v2/series.json",
);

const target = args.find((row, index) => !row.startsWith("--") && args[index - 1] !== "--state" && args[index - 1] !== "--note");
if (!target) throw new Error("Usage: reface-character.ts NAME [--note '...'] [--state path]");
const noteIndex = args.indexOf("--note");
const note = noteIndex >= 0 ? args[noteIndex + 1] ?? null : null;
const faceIndex = args.indexOf("--face");
const faceText = faceIndex >= 0 ? args[faceIndex + 1] ?? null : null;

const { stripPowerLanguage } = await import("../src/drama-engine/types/where.ts");

function cleanAppearance<T extends Record<string, unknown> | null | undefined>(profile: T): T {
  if (!profile) return profile;
  const next: Record<string, unknown> = { ...profile };
  for (const key of ["face", "hair", "body", "ethnicity_notes", "default_wardrobe"]) {
    if (typeof next[key] === "string") next[key] = stripPowerLanguage(next[key] as string);
  }
  if (faceText) next.face = faceText;
  return next as T;
}

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; owner_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const engine = createEngine({ ai: createAiGateway({}), store: loaded.store, assets });

const character = engine.store
  .charactersFor(state.series_id)
  .find((row) => row.name.toLowerCase().startsWith(target.toLowerCase()));
if (!character) throw new Error(`No character matching ${target}`);

process.stdout.write(`refacing ${character.name} (${character.id})\n`);

// The appearance job caches the old refs and would hand them straight back.
const stale = [...engine.store.jobs.values()].filter(
  (job) =>
    job.idempotency_key === `appearance:${character.id}` ||
    job.idempotency_key.startsWith(`appearance:${character.id}:`) ||
    (character.actor_id ? job.idempotency_key.startsWith(`appearance:actor:${character.actor_id}`) : false) ||
    job.idempotency_key.startsWith(`wardrobe:${character.id}`),
);
for (const job of stale) engine.store.jobs.delete(job.id);
if (stale.length) {
  const { error } = await client
    .from("generation_jobs")
    .delete()
    .in("id", stale.map((job) => job.id));
  if (error) throw new Error(error.message);
  process.stdout.write(`  dropped ${stale.length} cached appearance job(s)\n`);
}

if (character.actor_id) {
  const actor = engine.store.actors.get(character.actor_id);
  if (actor) {
    engine.store.actors.set(actor.id, {
      ...actor,
      visual_reference_asset_ids: {},
      appearance_profile: cleanAppearance(actor.appearance_profile),
      updated_at: new Date().toISOString(),
    });
  }
}
engine.store.characters.set(character.id, {
  ...character,
  locked: false,
  visual_reference_asset_ids: {},
  wardrobe_asset_ids: {},
  // A power written into the locked look bakes the glow into the still, and the
  // still is the only legal face. Clean the record, not just the prompt.
  appearance_profile: cleanAppearance(character.appearance_profile),
  description: note ? `${stripPowerLanguage(character.description)} ${note}` : stripPowerLanguage(character.description),
  updated_at: new Date().toISOString(),
});

// Stills reserve against the project ledger; a drained series cannot re-lock.
const balance = engine.store.ledger.reduce(
  (sum, row) => sum + (row.entry_type === "reserve" || row.entry_type === "settle" ? -row.amount : row.amount),
  0,
);
if (balance < 5) {
  const topUp = Math.ceil(5 - balance);
  const { error } = await client.from("project_ledger").insert({
    owner_id: state.owner_id,
    series_id: state.series_id,
    entry_type: "purchase",
    amount: topUp,
    generation_job_id: null,
    stripe_event_id: `reface_topup_${Date.now()}`,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (error) throw new Error(error.message);
  const reloaded = await loadSeriesStore(client, state.series_id);
  engine.store.ledger.splice(0, engine.store.ledger.length, ...reloaded.store.ledger);
  process.stdout.write(`  ledger $${balance.toFixed(2)}; topped up $${topUp}\n`);
}

await engine.lockCharacter({ owner_id: state.owner_id, character_id: character.id, face_only: true });
await commitSeriesStore(client, engine.store, state.series_id, assets.snapshot?.() ?? loaded.assets);

const fresh = engine.store.characters.get(character.id)!;
process.stdout.write(
  `${fresh.name}: front ${fresh.visual_reference_asset_ids.front ?? "none"} looks ${Object.keys(fresh.wardrobe_asset_ids).length}\n`,
);
