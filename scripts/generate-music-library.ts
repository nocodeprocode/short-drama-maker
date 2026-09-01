import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MUSIC_LIBRARY } from "../src/drama-engine/types/audio.ts";
import { resolveMusicFile } from "../src/drama-engine/craft/music/library.ts";
import { composeElevenMusic, composeElevenSfx } from "../src/engine/ai/elevenlabs.ts";
import { loadLocalEnv } from "./load-env.ts";

const PROMPTS: Record<string, { prompt: string; lengthMs?: number; sfxSeconds?: number }> = {
  "bed-thriller": {
    prompt:
      "Instrumental cinematic thriller underscore, low strings and muted piano, tense kitchen argument, no vocals, no melody hook, dark and intimate, 90 bpm.",
    lengthMs: 45_000,
  },
  "bed-romance": {
    prompt:
      "Instrumental bittersweet romance pad, warm low cello and soft piano, no vocals, under dialogue, 70 bpm.",
    lengthMs: 40_000,
  },
  "bed-estate": {
    prompt:
      "Instrumental night estate underscore, distant piano in a marble lobby, elegant and cold, no vocals.",
    lengthMs: 40_000,
  },
  "bed-sting-tension": {
    prompt: "Instrumental tension drone, rising low brass, no vocals, score for a withheld name.",
    lengthMs: 30_000,
  },
  "sting-impact": {
    prompt: "Short cinematic impact sting, no melody, one hit then tail.",
    sfxSeconds: 2.2,
  },
  "sting-comic": {
    prompt: "Short comic stunned sting for I did not know, dry and sharp, not cartoony.",
    sfxSeconds: 1.8,
  },
  "sting-stunned": {
    prompt: "Short stunned silence-break sting, high thin string then drop.",
    sfxSeconds: 1.6,
  },
  "sfx-slap": { prompt: "Single slap hit, dry, no reverb wash.", sfxSeconds: 1.2 },
  "sfx-door": { prompt: "Heavy interior door close, estate wood, no voices.", sfxSeconds: 1.8 },
  "sfx-glass": { prompt: "Water glass tap on marble, small stun, no voices.", sfxSeconds: 1.4 },
  "sfx-paper": { prompt: "Paper slide across stone, one short rustle.", sfxSeconds: 1.3 },
};

async function main() {
  loadLocalEnv();
  if (!process.env.ELEVENLABS_API_KEY?.trim()) throw new Error("ELEVENLABS_API_KEY is required");
  for (const entry of MUSIC_LIBRARY) {
    if (resolveMusicFile(entry)) {
      process.stdout.write(`keep ${entry.file}\n`);
      continue;
    }
    const spec = PROMPTS[entry.id];
    if (!spec) throw new Error(`No prompt for ${entry.id}`);
    const dest = resolve(process.cwd(), entry.file);
    await mkdir(dirname(dest), { recursive: true });
    process.stdout.write(`gen ${entry.id}\n`);
    const bytes =
      entry.kind === "bed"
        ? await composeElevenMusic({ prompt: spec.prompt, lengthMs: spec.lengthMs ?? 40_000, instrumental: true })
        : await composeElevenSfx({ prompt: spec.prompt, durationSeconds: spec.sfxSeconds ?? 1.6 });
    await writeFile(dest, bytes);
  }
  process.stdout.write("Music library ready.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
