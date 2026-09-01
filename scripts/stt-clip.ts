import { readFile, writeFile } from "node:fs/promises";
import { loadLocalEnv } from "./load-env.ts";
import { openRouterRaw } from "../src/engine/ai/openrouter.ts";
import { foldSpoken } from "../src/engine/media/qc.ts";

loadLocalEnv();
const bytes = await readFile("assets/07-wan-audio.mp3");
const raw = await openRouterRaw("/audio/transcriptions", {
  method: "POST",
  body: JSON.stringify({
    model: "google/chirp-3",
    input_audio: { data: bytes.toString("base64"), format: "mp3" },
  }),
});
process.stdout.write(`${raw.status} ${raw.text.slice(0, 800)}\n`);
if (!raw.ok) process.exit(1);
const text = (JSON.parse(raw.text) as { text?: string }).text ?? "";
const line = "You knew about this for three months.";
const match = foldSpoken(text) === foldSpoken(line);
process.stdout.write(`STT: ${text}\nmatch: ${match}\n`);
const report = JSON.parse(await readFile("assets/07-wan-audio.json", "utf8")) as Record<string, unknown>;
report.stt = text;
report.stt_error = null;
report.transcript_matches = match;
report.extracted_audio = "assets/07-wan-audio.mp3";
await writeFile("assets/07-wan-audio.json", JSON.stringify(report, null, 2));
