import { openRouterJson } from "./openrouter.ts";

export async function transcribeAudio(input: {
  bytes: Uint8Array;
  format: string;
}): Promise<{ text: string }> {
  const data = Buffer.from(input.bytes).toString("base64");
  const body = await openRouterJson<{ text?: string }>("/audio/transcriptions", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.OPENROUTER_STT_MODEL?.trim() || "openai/whisper-large-v3",
      input_audio: { data, format: input.format },
    }),
  });
  if (!body.text?.trim()) {
    throw new Error("OpenRouter STT returned an empty transcript");
  }
  return { text: body.text };
}
