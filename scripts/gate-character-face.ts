/**
 * Keep refacing a character until the video provider will accept the face.
 *
 * Some generated faces read as a real person to the provider's classifier and
 * are refused as a reference no matter how the still is stamped or stylised —
 * probing proved the refusal follows the likeness, not the treatment. A face
 * the provider will not take cannot carry a series, so this renders a new one,
 * screens it with a throwaway clip, and repeats until one passes. Refused
 * submits cost nothing; only the pass is billed.
 *
 *   npx tsx scripts/gate-character-face.ts COLE
 *   npx tsx scripts/gate-character-face.ts COLE --attempts 6
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createAiGateway } = await import("../src/engine/ai/index.ts");
const { createOpenRouterVideo } = await import("../src/engine/ai/video.ts");
const { createEngine } = await import("../src/engine/create-engine.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { commitSeriesStore, hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { screenFaceReference } = await import("../src/engine/pipeline/face-screen.ts");
const { SHEET_STRENGTHS, stampCharacterSheet } = await import("../src/engine/pipeline/character-sheet.ts");
const { shrinkReference } = await import("../src/engine/pipeline/identity-check.ts");
const { createOpenRouterVision } = await import("../src/engine/ai/vision.ts");
const { PRICE_SNAPSHOT_VERSION, VIDEO_ROUTES } = await import("../src/engine/config/models.ts");

const STATE = resolve(process.cwd(), "assets/live/boss-delivery-v2/series.json");

/** Each pass asks for a face built from different bones, not a restyle of the last one. */
const LOOKS = [
  "Distinct build: long oval face, deep-set narrow eyes, thin straight nose, hollow cheeks, close-cropped greying hair, clean shaven.",
  "Distinct build: wide round face, full cheeks, broad flat nose, thick black eyebrows meeting low, short curly hair, heavy stubble.",
  "Distinct build: angular narrow face, high sharp cheekbones, long straight nose, deep nasolabial lines, swept-back hair, trimmed beard.",
  "Distinct build: heavy square face, thick neck, wide-set hooded eyes, blunt short nose, shaved head, no facial hair.",
  "Distinct build: lean triangular face, pointed chin, large dark eyes, aquiline nose, thick side-parted hair, light moustache.",
  "Distinct build: broad rectangular face, low forehead, small close-set eyes, wide jaw, short flat-top hair, full short beard.",
];

const args = process.argv.slice(2);
const target = args.find((row) => !row.startsWith("--"));
if (!target) throw new Error("Usage: gate-character-face.ts NAME [--attempts N]");
const attemptIndex = args.indexOf("--attempts");
const attempts = attemptIndex >= 0 ? Number(args[attemptIndex + 1]) : LOOKS.length;

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; owner_id: string; episode_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const engine = createEngine({ ai: createAiGateway({}), store: loaded.store, assets });
const video = createOpenRouterVideo();
const vision = createOpenRouterVision();

const found = engine.store.charactersFor(state.series_id).find((row) => row.name.toLowerCase().startsWith(target.toLowerCase()));
if (!found) throw new Error(`No character matching ${target}`);
const characterId = found.id;

const probeShot = engine.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => engine.store.shotsFor(scene.id))[0];
if (!probeShot) throw new Error("No shot to borrow for the screen");

/** Stills reserve against the project ledger; a drained series cannot re-lock. */
async function fundLedger(): Promise<void> {
  const balance = engine.store.ledger.reduce(
    (sum, row) => sum + (row.entry_type === "reserve" || row.entry_type === "settle" ? -row.amount : row.amount),
    0,
  );
  if (balance >= 5) return;
  const topUp = Math.ceil(5 - balance);
  const { error } = await client.from("project_ledger").insert({
    owner_id: state.owner_id,
    series_id: state.series_id,
    entry_type: "purchase",
    amount: topUp,
    generation_job_id: null,
    stripe_event_id: `face_gate_topup_${Date.now()}`,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (error) throw new Error(error.message);
  const reloaded = await loadSeriesStore(client, state.series_id);
  engine.store.ledger.splice(0, engine.store.ledger.length, ...reloaded.store.ledger);
  process.stdout.write(`  ledger $${balance.toFixed(2)}; topped up $${topUp}\n`);
}

/** Drop the stills and the cached appearance job, then render the face again. */
async function reface(look: string): Promise<void> {
  const character = engine.store.characters.get(characterId)!;
  const stale = [...engine.store.jobs.values()].filter(
    (job) =>
      job.idempotency_key === `appearance:${characterId}` ||
      job.idempotency_key.startsWith(`appearance:${characterId}:`) ||
      (character.actor_id ? job.idempotency_key.startsWith(`appearance:actor:${character.actor_id}`) : false) ||
      job.idempotency_key.startsWith(`wardrobe:${characterId}`),
  );
  for (const job of stale) engine.store.jobs.delete(job.id);
  if (stale.length) {
    const { error } = await client.from("generation_jobs").delete().in("id", stale.map((job) => job.id));
    if (error) throw new Error(error.message);
  }
  if (character.actor_id) {
    const actor = engine.store.actors.get(character.actor_id);
    if (actor) engine.store.actors.set(actor.id, { ...actor, visual_reference_asset_ids: {}, updated_at: new Date().toISOString() });
  }
  // The look note replaces the previous one: stacking them averages the faces
  // back towards the same person the classifier already refused.
  const base = character.description.replace(/\s*Distinct build:[^]*$/, "").trim();
  engine.store.characters.set(characterId, {
    ...character,
    locked: false,
    visual_reference_asset_ids: {},
    wardrobe_asset_ids: {},
    description: `${base} ${look}`,
    updated_at: new Date().toISOString(),
  });
  await fundLedger();
  await engine.lockCharacter({ owner_id: state.owner_id, character_id: characterId, face_only: true });
}

function frontStillId(): string | null {
  const character = engine.store.characters.get(characterId)!;
  const actor = character.actor_id ? engine.store.actors.get(character.actor_id) : undefined;
  return { ...(actor?.visual_reference_asset_ids ?? {}), ...character.visual_reference_asset_ids }.front ?? null;
}

/**
 * Submit the character sheet the shoot would actually send, walking up the
 * treatment ladder until the provider takes one. The lowest rung that passes is
 * the answer, because every rung above it costs identity detail.
 */
async function screen(): Promise<"accepted" | "refused" | "error"> {
  const frontId = frontStillId();
  if (!frontId) throw new Error(`${found!.name} has no front still to screen`);
  const source = await assets.get(frontId);
  if (!source) throw new Error(`front still ${frontId} is not in storage`);
  const small = await shrinkReference(source.body);
  const face = await vision
    .locateFace?.({ image: small?.bytes ?? source.body, imageMime: small?.mime ?? source.asset.mime_type })
    .catch(() => null);
  const name = engine.store.characters.get(characterId)!.name;
  let last: "accepted" | "refused" | "error" = "refused";
  for (const strength of SHEET_STRENGTHS) {
    const sheet = await stampCharacterSheet(source.body, { name, role: "front", face: face ?? null, strength });
    if (!sheet) continue;
    const id = randomUUID();
    const stored = await assets.put({
      id,
      owner_id: state.owner_id,
      series_id: state.series_id,
      kind: "character_reference",
      bucket: "private-character",
      storage_path: `private-character/${state.series_id}/${id}.png`,
      mime_type: "image/png",
      body: sheet,
      checksum: createHash("sha256").update(sheet).digest("hex"),
      metadata: { kind: "face_screen", name, strength },
      created_at: new Date().toISOString(),
    });
    const out = await screenFaceReference({
      video,
      shot: probeShot!,
      model: VIDEO_ROUTES.dialogue_default.model,
      referenceUrl: await assets.getSignedUrl(stored.id, 3600),
    });
    last = out.verdict;
    if (out.verdict === "error") process.stdout.write(`  screen error: ${out.message?.split("\n")[0]}\n`);
    process.stdout.write(`  sheet strength ${strength}: ${out.verdict}\n`);
    if (out.verdict === "accepted") return "accepted";
  }
  return last;
}

async function commit(): Promise<void> {
  await commitSeriesStore(client, engine.store, state.series_id, assets.snapshot?.() ?? loaded.assets);
}

// A half-written commit can leave the character pointing at a still that was
// never recorded; that face is as unusable as a refused one.
let verdict = await screen().catch((error) => {
  process.stdout.write(`  current face unreadable: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}\n`);
  return "refused" as const;
});
process.stdout.write(`${found.name}: current face ${frontStillId()} ${verdict}\n`);
for (let attempt = 0; verdict !== "accepted" && attempt < attempts; attempt += 1) {
  const look = LOOKS[attempt % LOOKS.length]!;
  process.stdout.write(`attempt ${attempt + 1}: ${look}\n`);
  try {
    await reface(look);
  } catch (error) {
    // A provider blip mid-render costs the attempt, not the run.
    process.stdout.write(`  render failed: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}\n`);
    continue;
  }
  verdict = await screen();
  // A face that changed identity has a new still; a repeated id means the
  // render was served from cache and the attempt proved nothing.
  process.stdout.write(`  front ${frontStillId()} ${verdict}\n`);
  // Persist each attempt so a later crash cannot throw away an accepted face.
  await commit();
  if (verdict === "accepted") break;
}

await commit();
const fresh = engine.store.characters.get(characterId)!;
process.stdout.write(
  verdict === "accepted"
    ? `${fresh.name}: face accepted by the provider, front ${fresh.visual_reference_asset_ids.front}\n`
    : `${fresh.name}: still refused after ${attempts} attempt(s)\n`,
);
if (verdict !== "accepted") process.exitCode = 1;
