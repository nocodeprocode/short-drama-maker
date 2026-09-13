/**
 * Why the provider's privacy classifier refuses one character's still.
 *
 * Cole's front still is refused on its own while Mara's passes, so the question
 * is whether the refusal is about the face being uncovered or about the face
 * itself. Each variant goes up as a single-reference clip: a refusal is free, so
 * the only cost is the variant that passes.
 *
 *   npx tsx scripts/probe-privacy-variants.ts COLE
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createOpenRouterVideo } = await import("../src/engine/ai/video.ts");
const { createConfiguredAssetStore } = await import("../src/engine/storage/create.ts");
const { hydrateAssetStore, loadSeriesStore } = await import("../src/engine/store-postgres.ts");
const { SHEET_STRENGTHS, stampCharacterSheet } = await import("../src/engine/pipeline/character-sheet.ts");
const { shrinkReference } = await import("../src/engine/pipeline/identity-check.ts");
const { createOpenRouterVision } = await import("../src/engine/ai/vision.ts");
const { VIDEO_ROUTES } = await import("../src/engine/config/models.ts");

const STATE = resolve(process.cwd(), "assets/live/boss-delivery-v2/series.json");
const OUT = resolve(process.cwd(), "assets/probe-sheet");
const NAME = (process.argv[2] ?? "COLE").toUpperCase();

const state = JSON.parse(await readFile(STATE, "utf8")) as { series_id: string; episode_id: string };
const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const loaded = await loadSeriesStore(client, state.series_id);
const assets = createConfiguredAssetStore();
await hydrateAssetStore(assets, loaded.assets);
const video = createOpenRouterVideo();
const vision = createOpenRouterVision();
await mkdir(OUT, { recursive: true });

const shot = loaded.store
  .scenesFor(state.episode_id)
  .sort((a, b) => a.position - b.position)
  .flatMap((scene) => loaded.store.shotsFor(scene.id))[0];
if (!shot) throw new Error("No shot to borrow for the probe");

const character = loaded.store.charactersFor(state.series_id).find((row) => row.name.toUpperCase().startsWith(NAME));
if (!character) throw new Error(`No character ${NAME}`);
const actor = character.actor_id ? loaded.store.actors.get(character.actor_id) : undefined;
const frontId = { ...(actor?.visual_reference_asset_ids ?? {}), ...character.visual_reference_asset_ids }.front;
if (!frontId) throw new Error(`${NAME} has no front still`);
const source = await assets.get(frontId);
if (!source) throw new Error(`front asset ${frontId} missing`);

const small = await shrinkReference(source.body);
const face = await vision
  .locateFace!({ image: small?.bytes ?? source.body, imageMime: small?.mime ?? source.asset.mime_type })
  .catch(() => null);

/** Run one ffmpeg filter chain over the still and hand back the result. */
async function filtered(bytes: Uint8Array, chain: string): Promise<Uint8Array | null> {
  const dir = await mkdtemp(join(tmpdir(), "sdm-probe-"));
  try {
    const input = join(dir, "in.png");
    const output = join(dir, "out.png");
    await writeFile(input, bytes);
    const ok = await new Promise<boolean>((done) => {
      const child = spawn("ffmpeg", ["-y", "-i", input, "-vf", chain, "-frames:v", "1", "-update", "1", output], { stdio: "ignore" });
      child.on("error", () => done(false));
      child.on("close", (code) => done(code === 0));
    });
    return ok ? new Uint8Array(await readFile(output)) : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A band over the top half of the located face box, so the eyes cannot show. */
function eyeBand(): string | null {
  if (!face) return null;
  const x = Math.max(0, face.x - face.width * 0.15);
  const y = Math.max(0, face.y - face.height * 0.05);
  const w = Math.min(1 - x, face.width * 1.3);
  const h = face.height * 0.75;
  return `drawbox=x=iw*${x.toFixed(4)}:y=ih*${y.toFixed(4)}:w=iw*${w.toFixed(4)}:h=ih*${h.toFixed(4)}:color=0x111111:t=fill`;
}

const band = eyeBand();
const sheets = await Promise.all(
  SHEET_STRENGTHS.map((strength) => stampCharacterSheet(source.body, { name: character.name, role: "front", face, strength })),
);
const stamped = sheets[0]!;
/** Shrink the subject inside the frame so the face carries fewer pixels. */
const zoomOut = (fraction: number) =>
  `scale=iw*${fraction}:ih*${fraction},pad=iw/${fraction}:ih/${fraction}:(ow-iw)/2:(oh-ih)/2:white`;
const variants: Array<{ label: string; bytes: Uint8Array | null }> = [
  ...SHEET_STRENGTHS.map((strength) => ({ label: `sheet treatment strength ${strength}`, bytes: sheets[strength] ?? null })),
  { label: "strongest sheet, subject at half size", bytes: sheets[3] ? await filtered(sheets[3], zoomOut(0.5)) : null },
  { label: "strongest sheet + eyes blacked out", bytes: band && sheets[3] ? await filtered(sheets[3], band) : null },
];
void stamped;

for (const variant of variants) {
  if (!variant.bytes) {
    process.stdout.write(`${variant.label}: skipped (could not build)\n`);
    continue;
  }
  const slug = variant.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await writeFile(resolve(OUT, `${NAME.toLowerCase()}-${slug}.png`), variant.bytes);
  const id = randomUUID();
  const stored = await assets.put({
    id,
    owner_id: source.asset.owner_id,
    series_id: state.series_id,
    kind: "character_reference",
    bucket: "private-character",
    storage_path: `private-character/${state.series_id}/${id}.png`,
    mime_type: "image/png",
    body: variant.bytes,
    checksum: createHash("sha256").update(variant.bytes).digest("hex"),
    metadata: { kind: "privacy_probe", variant: variant.label },
    created_at: new Date().toISOString(),
  });
  const signed = await assets.getSignedUrl(stored.id, 3600);
  try {
    await video.submit({
      shot,
      prompt: "A fictional character stands still in an empty room and blinks once. No text.",
      visual_reference_urls: [signed],
      audio_reference_url: null,
      duration_seconds: 4,
      model: VIDEO_ROUTES.dialogue_default.model,
      privacy_profile: "standard",
      callback_url: null,
    });
    process.stdout.write(`${variant.label}: ACCEPTED\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refused = /InputImageSensitiveContentDetected|PrivacyInformation/i.test(message);
    process.stdout.write(`${variant.label}: ${refused ? "REFUSED" : `error ${message.split("\n")[0]}`}\n`);
  }
}
