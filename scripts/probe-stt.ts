/**
 * Transcribe one local clip through the configured STT path and print the raw
 * failure. Captions are placed on these word timings, so a silent STT failure
 * shows up as drifting subtitles rather than an error.
 *
 *   npx tsx scripts/probe-stt.ts assets/live/wolf-boss-hired-his-mate/scene-01.mp4
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { extractAudioMp3 } = await import("../src/engine/media/extract-audio.ts");
const { transcribeAudio } = await import("../src/engine/ai/stt.ts");

const file = resolve(process.cwd(), process.argv[2] ?? "");
const video = new Uint8Array(await readFile(file));
const mp3 = await extractAudioMp3(video);
process.stdout.write(`audio ${mp3.byteLength} bytes; model ${process.env.OPENROUTER_STT_MODEL ?? "openai/whisper-large-v3"}\n`);

try {
  const out = await transcribeAudio({ bytes: mp3, format: "mp3" });
  process.stdout.write(`text: ${out.text.slice(0, 200)}\n`);
  process.stdout.write(`words: ${out.words.length}; onset ${out.speech_onset_seconds}\n`);
  process.stdout.write(`${JSON.stringify(out.words.slice(0, 8), null, 1)}\n`);
} catch (error) {
  process.stdout.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
}
