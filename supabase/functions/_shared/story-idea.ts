import { moderateText } from "./moderation.ts";

export const STORY_DIRECTIONS = [
  { id: "contract", label: "Contract marriage" },
  { id: "secret_child", label: "Secret child" },
  { id: "revenge", label: "Revenge" },
  { id: "hidden_identity", label: "Hidden identity" },
  { id: "second_chance", label: "Second chance" },
  { id: "family_secret", label: "Family secret" },
  { id: "amnesia", label: "Memory loss" },
  { id: "surprise", label: "Surprise me" },
] as const;

export type StoryIdea = {
  title: string;
  brief: string;
  category: string;
};

const IDEA_MODEL = "openai/gpt-4o-mini";

const SYSTEM = `You invent original vertical short-drama series for Drama Space.
Rules:
- Every character is fictional and an adult. Never use a real person's name or likeness.
- The product is 15 to 60 episodes of 60 to 90 seconds each. Write a series idea, not a feature film.
- The brief is 2 to 4 sentences. Name the lead. End on the episode 1 cliffhanger.
- Titles are 2 to 5 words, specific, not generic ("The Secret", "Love Again").
- No sexual content, no minors, no celebrities.
- Return JSON only: {"title":"...","brief":"...","category":"..."}`;

const FALLBACKS: StoryIdea[] = [
  {
    title: "The Night Ledger",
    brief:
      "A 27-year-old auditor finds a second set of books in her husband's study. Episode 1 ends on the photograph that proves the other life is real.",
    category: "family_secret",
  },
  {
    title: "Wife on Paper",
    brief:
      "A debt-squeezed designer signs a one-year marriage contract with a cold hotel heir who needs a public spouse. Episode 1 ends when his mother produces a child he never mentioned.",
    category: "contract",
  },
  {
    title: "Her Second Name",
    brief:
      "A quiet florist is recognized by a dying CEO as the daughter he hid twenty years ago. Episode 1 ends when the will is read and her name is already printed in it.",
    category: "secret_child",
  },
];

export function directionLabel(id: string | undefined): string | undefined {
  return STORY_DIRECTIONS.find((item) => item.id === id)?.label;
}

export async function generateStoryIdea(input: {
  hint?: string;
  category?: string;
}): Promise<StoryIdea> {
  const hint = String(input.hint ?? "").trim().slice(0, 280);
  const category = String(input.category ?? "surprise").trim() || "surprise";
  const combined = `${directionLabel(category) ?? category} ${hint}`.trim();
  if (combined) {
    const incoming = moderateText(combined, "story_idea_hint");
    if (incoming.verdict === "block") {
      const error = new Error(incoming.reason);
      error.name = "PolicyError";
      throw error;
    }
  }

  const idea = await completeIdea(hint, category);
  const outgoing = moderateText(`${idea.title}\n${idea.brief}`, "story_idea");
  if (outgoing.verdict === "block") {
    return pickFallback(category);
  }
  return idea;
}

async function completeIdea(hint: string, category: string): Promise<StoryIdea> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) return pickFallback(category);

  const label = directionLabel(category);
  const user = [
    label && label !== "Surprise me" ? `Category: ${label}.` : "Pick a strong short-drama category.",
    hint ? `User steer: ${hint}` : "Invent a fresh hook. Do not reuse famous plots beat-for-beat.",
    `Variety seed: ${Date.now() % 9973}`,
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "http-referer": "https://dramaspacestudio.com",
      "x-title": "Drama Space",
    },
    body: JSON.stringify({
      model: IDEA_MODEL,
      temperature: 0.95,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    return pickFallback(category);
  }
  try {
    const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(extractJson(content)) as Partial<StoryIdea>;
    const title = String(parsed.title ?? "").trim();
    const brief = String(parsed.brief ?? "").trim();
    if (title.length < 3 || brief.length < 40) return pickFallback(category);
    return {
      title: title.slice(0, 60),
      brief: brief.slice(0, 600),
      category: String(parsed.category ?? category),
    };
  } catch {
    return pickFallback(category);
  }
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function pickFallback(category: string): StoryIdea {
  const match = FALLBACKS.filter((item) => item.category === category);
  const pool = match.length ? match : FALLBACKS;
  return pool[Date.now() % pool.length]!;
}
