import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const productionId = "9af2694d-5564-4502-be19-d0a3aa1aa2d3";
  const seriesId = "92d0a750-01a7-4800-97fe-10a16cafde72";
  const doReset = process.argv.includes("--reset");

  const [{ data: production }, { data: episodes }, { data: ledger }] = await Promise.all([
    client.from("productions").select("*").eq("id", productionId).single(),
    client.from("episodes").select("*").eq("series_id", seriesId).order("episode_number"),
    client.from("project_ledger").select("entry_type,amount,status").eq("series_id", seriesId),
  ]);
  const ep1 = episodes?.find((episode) => episode.episode_number === 1);
  if (!ep1) throw new Error("Episode 1 not found");

  const { data: scenes } = await client.from("scenes").select("id,position").eq("episode_id", ep1.id).order("position");
  const sceneIds = (scenes ?? []).map((scene) => scene.id);
  const { data: shots } = sceneIds.length
    ? await client.from("shots").select("id,position,shot_data").in("scene_id", sceneIds).order("position")
    : { data: [] };

  const settled = (ledger ?? []).filter((row) => row.status === "settled").reduce((acc, row) => acc + Number(row.amount), 0);
  const held = (ledger ?? []).filter((row) => row.status === "held").reduce((acc, row) => acc + Number(row.amount), 0);

  console.log(
    JSON.stringify(
      {
        production: {
          id: production?.id,
          status: production?.status,
          ui_phase: production?.ui_phase,
          episode_length: production?.episode_length,
        },
        ep1: {
          id: ep1.id,
          status: ep1.status,
          sceneCount: sceneIds.length,
          shotCount: shots?.length ?? 0,
          firstShots: (shots ?? []).slice(0, 4).map((shot, index) => ({
            n: index + 1,
            fn: (shot.shot_data as Record<string, unknown>)?.function,
            type: (shot.shot_data as Record<string, unknown>)?.type,
            dlg: String((shot.shot_data as Record<string, unknown>)?.dialogue ?? "").slice(0, 50),
            dur: (shot.shot_data as Record<string, unknown>)?.duration_hint_seconds,
          })),
        },
        spend: { settled, held },
      },
      null,
      2,
    ),
  );

  if (!doReset) return;

  if (sceneIds.length) {
    const { error: sceneError } = await client.from("scenes").delete().in("id", sceneIds);
    if (sceneError) throw new Error(sceneError.message);
  }
  const { error: episodeError } = await client
    .from("episodes")
    .update({ status: "draft", script: "", episode_outline: null, render_manifest: null, updated_at: new Date().toISOString() })
    .eq("id", ep1.id);
  if (episodeError) throw new Error(episodeError.message);

  await client
    .from("engine_tasks")
    .update({ status: "cancelled", error: "reset ep1 plan" })
    .eq("production_id", productionId)
    .in("status", ["queued", "running"]);

  const { error: productionError } = await client
    .from("productions")
    .update({
      status: "queued",
      ui_phase: "preparing",
      intervention: {},
      agent_decision: "Episode 1 plan reset for handbook replan.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", productionId);
  if (productionError) throw new Error(productionError.message);

  const { error: taskError } = await client.from("engine_tasks").insert({
    owner_id: production!.owner_id,
    series_id: seriesId,
    production_id: productionId,
    action: "advance_production",
    payload: { production_id: productionId },
    status: "queued",
  });
  if (taskError) throw new Error(taskError.message);

  console.log(`reset ep1: deleted ${sceneIds.length} scene(s); production re-queued`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
