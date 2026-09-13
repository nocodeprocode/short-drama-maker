import { moderateText } from "./moderation.ts";

export type AdaptedScript = {
  title: string;
  brief: string;
  source_language: string;
  source_language_name: string;
};

const MODEL = "openai/gpt-4o-mini";
const MAX_CHARS = 24_000;

const SYSTEM = `You adapt an uploaded short-drama script for Takehaus, a vertical series studio.
The writer may paste Chinese or another language. Do the work automatically. No extra questions.

Rules:
- Detect the source language.
- If it is not English, translate into natural spoken English. Not word-for-word. Names stay unless they are unreadable romanizations — then give a clean English-usable form and keep the original in parentheses once.
- Polish: tighter hooks, clearer conflict, production-ready. Do not invent a new plot. Keep the author's story, characters, and ending.
- Every character is a fictional adult. No real people, no minors, no sexual content.
- Title: 2 to 6 words, specific.
- Brief: 5 to 8 sentences. Name the lead. State the core expectation. Sketch the season. End on the episode 1 cliffhanger. This brief is the only story the production bible will see, so keep the plot, not a logline only.
- Return JSON only: {"title":"...","brief":"...","source_language":"zh","source_language_name":"Chinese"}`;

export async function adaptUploadedScript(text: string): Promise<AdaptedScript> {
  const script = String(text ?? "").replace(/\u0000/g, "").trim();
  if (script.length < 40) {
    throw Object.assign(new Error("The script is too short to adapt."), { name: "InputError" });
  }
  const incoming = moderateText(script.slice(0, 4000), "story_script");
  if (incoming.verdict === "block") {
    throw Object.assign(new Error(incoming.reason), { name: "PolicyError" });
  }

  const adapted = await completeAdapt(script.slice(0, MAX_CHARS));
  const outgoing = moderateText(`${adapted.title}\n${adapted.brief}`, "story_script");
  if (outgoing.verdict === "block") {
    throw Object.assign(new Error(outgoing.reason), { name: "PolicyError" });
  }
  return adapted;
}

async function completeAdapt(script: string): Promise<AdaptedScript> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) {
    throw Object.assign(new Error("Script adaptation is not configured."), { name: "ConfigError" });
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "http-referer": "https://dramaspacestudio.com",
      "x-title": "Takehaus",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Adapt this uploaded script. Translate if needed. Polish, do not replace.\n\n---\n${script}`,
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error("Could not adapt the script."), { name: "UpstreamError" });
  }
  try {
    const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(extractJson(content)) as Partial<AdaptedScript>;
    const title = String(parsed.title ?? "").trim();
    const brief = String(parsed.brief ?? "").trim();
    if (title.length < 3 || brief.length < 80) {
      throw new Error("thin");
    }
    return {
      title: title.slice(0, 80),
      brief: brief.slice(0, 2400),
      source_language: String(parsed.source_language ?? "und").trim().slice(0, 12) || "und",
      source_language_name: String(parsed.source_language_name ?? "Unknown").trim().slice(0, 40) || "Unknown",
    };
  } catch {
    throw Object.assign(new Error("Could not read the adapted script."), { name: "UpstreamError" });
  }
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
