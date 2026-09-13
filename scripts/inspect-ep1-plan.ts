import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";
import { repairEpisodePlan } from "../src/drama-engine/lint/repair.ts";
import { validateEpisodePlan, assertDramaPlan } from "../src/drama-engine/lint/validate-plan.ts";
import type { EpisodePlan } from "../src/engine/domain.ts";

async function main() {
  loadLocalEnv();
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const epId = "98b55e2d-b24a-4ae4-9c83-a27e255d6bda";
  const seriesId = "92d0a750-01a7-4800-97fe-10a16cafde72";
  const [{ data: series }, { data: episode }, { data: scenes }] = await Promise.all([
    client.from("series").select("story_bible").eq("id", seriesId).single(),
    client.from("episodes").select("*").eq("id", epId).single(),
    client.from("scenes").select("*").eq("episode_id", epId).order("position"),
  ]);
  const sceneIds = (scenes ?? []).map((scene) => scene.id);
  const { data: shots } = sceneIds.length
    ? await client.from("shots").select("*").in("scene_id", sceneIds).order("position")
    : { data: [] };

  const plan: EpisodePlan = {
    title: episode?.title ?? "Ep 1",
    hook: "",
    conflict: "",
    cliffhanger: episode?.script ?? "",
    scenes: (scenes ?? []).map((scene) => ({
      location: scene.location,
      time: (scene.scene_data as { time?: string }).time ?? "night",
      characters: (scene.scene_data as { characters?: string[] }).characters ?? [],
      kind: (scene.scene_data as { kind?: string }).kind,
      shots: (shots ?? [])
        .filter((shot) => shot.scene_id === scene.id)
        .sort((a, b) => a.position - b.position)
        .map((shot) => {
          const data = shot.shot_data as EpisodePlan["scenes"][number]["shots"][number];
          return { ...data };
        }),
    })),
  };

  const namedCast = ((series?.story_bible as { characters?: { name: string }[] })?.characters ?? []).map((c) => c.name);
  const lint = validateEpisodePlan({ plan, namedCast, length: "60_90", episodeNumber: 1 });
  console.log("persisted", {
    shotCount: plan.scenes.flatMap((s) => s.shots).length,
    lintPass: lint.pass,
    blocking: lint.blocking.map((r) => `${r.id}:${r.actual}`),
  });

  const repaired = repairEpisodePlan({ plan, bible: series?.story_bible as never, namedCast, length: "60_90", episodeNumber: 1 });
  const repairedShots = repaired.scenes.flatMap((s) => s.shots);
  console.log("after repair", {
    shotCount: repairedShots.length,
    hasEstablishing: repairedShots.some((s) => s.function === "establishing" || s.type === "establishing"),
    hook: repairedShots[0]?.dialogue?.slice(0, 40),
  });
  try {
    assertDramaPlan({ plan: repaired, namedCast, length: "60_90", episodeNumber: 1 });
    console.log("assert: PASS");
  } catch (error) {
    console.log("assert: FAIL", error instanceof Error ? error.message : error);
  }
}

main().catch(console.error);
