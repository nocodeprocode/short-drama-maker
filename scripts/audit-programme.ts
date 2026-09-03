import { loadLocalEnv } from "./load-env.ts";
loadLocalEnv();
import { createClient } from "@supabase/supabase-js";
import { createConfiguredAssetStore } from "../src/engine/storage/create.ts";
import { hydrateAssetStore } from "../src/engine/store-postgres.ts";
import { auditMux } from "../src/engine/media/mux-audit.ts";
import { concatMp4Segments, concatWavSegments, mergeManifests, normalizeProgrammeLoudness } from "../src/engine/media/concat.ts";
import { LOUDNESS } from "../src/drama-engine/types/audio.ts";

const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: rows } = await c.from("assets").select("*").eq("series_id", "9046795d-32d6-41e3-b324-4d4e4c2a3d00").eq("kind", "episode_block").is("deleted_at", null).order("created_at", { ascending: false });
const assets = createConfiguredAssetStore() as any;
hydrateAssetStore(assets, rows!);
const blocks = rows!.filter((r, i, arr) => arr.findIndex((x) => x.metadata.block_index === r.metadata.block_index) === i).sort((a, b) => a.metadata.block_index - b.metadata.block_index);
const bodies: Uint8Array[] = [];
const manifests: any[] = [];
const lanes: string[] = [];
const analyses: any[] = [];
for (const b of blocks) {
  bodies.push((await assets.get(b.id)).body);
  manifests.push(b.metadata.manifest);
  lanes.push(...b.metadata.heard_lanes);
  const ids = b.metadata.manifest.shots.map((s: any) => s.shot_id);
  const { data: shots } = await c.from("shots").select("id, shot_data").in("id", ids);
  analyses.push(...b.metadata.manifest.shots.map((s: any) => shots!.find((x) => x.id === s.shot_id)?.shot_data?.take_analysis ?? null));
}
const joined = await concatMp4Segments(bodies);
const body = (await normalizeProgrammeLoudness(joined!, { lufs: LOUDNESS.mixLufs, truePeakDb: LOUDNESS.truePeakDb })).body;
let offset = 0;
const offsets = blocks.map((b) => {
  const at = offset;
  offset += Number(b.metadata.seconds);
  return at;
});
const manifest = mergeManifests("offline", manifests.map((m, i) => ({ manifest: m, offsetSeconds: offsets[i]! })));
const stemBodies: Array<{ body: Uint8Array; seconds: number }> = [];
for (const b of blocks) {
  const stemId = b.metadata.dialogue_stem_asset_id;
  if (!stemId) break;
  const { data: stemRow } = await c.from("assets").select("*").eq("id", stemId).single();
  hydrateAssetStore(assets, [stemRow!]);
  stemBodies.push({ body: (await assets.get(stemId)).body, seconds: Number(b.metadata.seconds) });
}
const dialogueStem = stemBodies.length === blocks.length ? await concatWavSegments(stemBodies) : null;
const a = await auditMux({ body, dialogueStem, manifest, analyses, heardLanes: lanes as any });
console.log("onset source", a.onset_source, "| ship", a.ship, "lufs", a.integrated_lufs, "tp", a.true_peak_dbfs, "dur", a.duration_seconds, "fails", a.lines.filter((l) => !l.pass).length, "of", a.lines.length);
console.log("reasons", a.reasons.filter((r) => !r.startsWith("sync")).join(",") || "-");
for (const l of a.lines.filter((l) => !l.pass)) console.log(l.shot_id.slice(0, 8), "start", l.picture_start_s, "expV", l.expected_voice_s, "gotV", l.voice_onset_s, "mouth", l.mouth_open_s, "lag", l.lag_ms, "lim", l.limit_ms, "head", l.head_step);
