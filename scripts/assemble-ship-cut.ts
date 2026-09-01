import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AlignmentTrack, EpisodePlan, Shot } from "../src/engine/domain.ts";
import { dramaHooks } from "../src/drama-engine/index.ts";
import { renderEpisodeBytes } from "../src/engine/media/render.ts";
import { probeVideoBytes } from "../src/engine/media/probe.ts";

const ROOT = resolve(process.cwd(), "assets");

function trackFromLine(text: string, duration: number): AlignmentTrack {
  const words = text.split(/\s+/).filter(Boolean);
  const step = Math.max(0.12, duration / Math.max(words.length, 1));
  return {
    text,
    characters: [],
    words: words.map((word, index) => ({
      word,
      start: Number((index * step).toFixed(3)),
      end: Number((Math.min(duration, (index + 1) * step)).toFixed(3)),
    })),
  };
}

async function main() {
  const plan = JSON.parse(await readFile(resolve(ROOT, "09-episode-plan.json"), "utf8")) as EpisodePlan;
  const planned = plan.scenes.flatMap((scene) => scene.shots);
  const keep = [
    { file: "drama-ship-hook_cu-1.mp4", position: 1 },
    { file: "drama-ship-accusation_cu-2.mp4", position: 2 },
    { file: "drama-ship-reaction-3.mp4", position: 3 },
    { file: "drama-ship-accusation_cu-4.mp4", position: 4 },
    { file: "drama-ship-accusation_cu-5.mp4", position: 5 },
    { file: "drama-ship-reaction-6.mp4", position: 6 },
    { file: "drama-ship-reaction-7.mp4", position: 7 },
    { file: "drama-ship-reaction-8.mp4", position: 8 },
    { file: "drama-ship-phone_ui-9.mp4", position: 9 },
    { file: "drama-ship-reaction-10.mp4", position: 10 },
    { file: "drama-ship-button_cu-12.mp4", position: 12 },
  ];
  const shots: Shot[] = [];
  const shotBodies: Uint8Array[] = [];
  const alignments: Array<AlignmentTrack | null> = [];
  for (const row of keep) {
    const body = await readFile(resolve(ROOT, row.file));
    const probe = probeVideoBytes(body);
    const planShot = planned[row.position - 1];
    if (!planShot) throw new Error(`Missing plan shot ${row.position}`);
    const shot: Shot = {
      id: `ship-${row.position}`,
      scene_id: "ship",
      position: row.position,
      selected_generation_id: row.file,
      status: "complete",
      shot_data: {
        type: planShot.type,
        speaker: planShot.speaker,
        dialogue: planShot.dialogue,
        emotion: planShot.emotion,
        delivery: planShot.delivery,
        pace: planShot.pace,
        camera: planShot.camera,
        mouth_visibility_required: planShot.mouth_visibility_required,
        duration_hint_seconds: planShot.duration_hint_seconds,
        duration_seconds: probe.duration_seconds || planShot.duration_hint_seconds,
        dialogue_audio_asset_id: null,
        dialogue_alignment_asset_id: null,
        hero: planShot.hero ?? false,
        edit_mode: planShot.edit_mode,
        audio_role: planShot.audio_role,
        speaker_on_camera: planShot.speaker_on_camera,
        speakers_off_camera: planShot.speakers_off_camera,
        eyeline: planShot.eyeline,
        function: planShot.function,
        silence_license: planShot.silence_license,
      },
    };
    shots.push(shot);
    shotBodies.push(body);
    alignments.push(planShot.dialogue ? trackFromLine(planShot.dialogue, shot.shot_data.duration_seconds ?? 4) : null);
  }
  const manifest = dramaHooks.buildRenderManifest({
    episode_id: "ship-cut",
    shots,
    assetIdFor: (shot) => String(shot.selected_generation_id),
  });
  const rendered = await renderEpisodeBytes({ manifest, shotBodies, alignments, ttsBodies: shots.map(() => null) });
  await writeFile(resolve(ROOT, "drama-ship-cut.mp4"), rendered.body);
  await writeFile(resolve(ROOT, "drama-ship-captions.vtt"), rendered.vtt);
  console.log(JSON.stringify({ bytes: rendered.body.byteLength, vtt_chars: rendered.vtt.length, takes: keep.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
