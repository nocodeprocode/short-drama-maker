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

export type StoryIdeaInput = {
  hint?: string;
  category?: string;
  lead?: string;
  opposite?: string;
  setting?: string;
};

/** Same writer family as the production bible. Sonnet is the fallback if Opus is dark. */
const IDEA_MODELS = ["anthropic/claude-opus-5", "anthropic/claude-sonnet-4.6"] as const;

const SYSTEM = `You invent original vertical short-drama series for Takehaus. The brief you write is the only story the production bible will see, so it has to be a show someone would actually watch tonight.

This is a coin-pack advertisement, not a prestige pilot. Write like an ad copywriter who understands ReelShort / DramaBox heat.

Hard rules:
- Every character is fictional and an adult. Never use a real person's name or likeness.
- The product is 15 to 90 episodes of 60 to 120 seconds. Write a series, not a feature film.
- One core expectation in a single sentence. The plot is the delay mechanism, not the promise.
- If it is a love story — almost all of these are — the leads meet in episode 1.
- Episode 1 opens at the height of the conflict. No runway. No drive home.
- Episode 1 ends on a CPI moment: a consequence starting, not a question being asked. Increase tension, never resolve it.
- Name the lead and the person they collide with. Give them a power imbalance the viewer can feel in one line.
- The setting is a specific contemporary interior we can lock (a named hospital floor, a penthouse, a family estate, a hotel, a firm). Not "a city." Prefer rooms over crowds, period, fantasy, or transformations.
- Titles are 2 to 6 words, specific, trope-legible. Never generic ("The Secret", "Love Again", "Broken Vows").
- No sexual content, no minors, no celebrities, no real brands as villains.
- If the user locked a lead, opposite, setting, or idea, those are law. Escalate them. Do not replace them with a stock plot.
- If they locked nothing, invent a commercially hot premise that feels current this week — a specific people-and-room version of a live trope (hidden identity, contract marriage, revenge, secret child, second chance, family secret). Do not recite a famous plot beat-for-beat.
- The brief is 5 to 8 sentences. Include: who they are, the locked rooms, the core expectation, how episode 1 opens, how episode 1 ends, and why a stranger would tap the next episode.
- Return JSON only: {"title":"...","brief":"...","category":"..."}`;

const FALLBACKS: StoryIdea[] = [
  {
    title: "The Night Ledger",
    brief:
      "Mara Voss, 27, is the night auditor who married a hotel heir to keep her mother in treatment. In his locked study she finds a second set of books and a photograph of a wife who is still alive. The core expectation: when will he admit the marriage was a cover for the theft. Episode 1 opens on her already in the study, not walking down the hall. It ends when she hears the study door lock from the outside and his voice, calm, on the other side: the photograph is the least of what he hid.",
    category: "family_secret",
  },
  {
    title: "Wife on Paper",
    brief:
      "A debt-squeezed designer signs a one-year marriage contract with a cold hotel heir who needs a public spouse before a board vote. The core expectation: when will the contract stop being the only thing holding them in the same room. Episode 1 opens at the courthouse counter, the ring already on. It ends when his mother produces a child he never mentioned and tells the designer the contract has a clause she was not shown.",
    category: "contract",
  },
  {
    title: "Her Second Name",
    brief:
      "A quiet florist is stopped in a private hospital corridor by a dying CEO who calls her the daughter he hid twenty years ago. The core expectation: when will the family who sold her out watch her take the company. Episode 1 opens on that corridor, not the shop. It ends at the will reading when her name is already printed, and the legitimate son realizes the document in his pocket is a copy.",
    category: "secret_child",
  },
];

export function directionLabel(id: string | undefined): string | undefined {
  return STORY_DIRECTIONS.find((item) => item.id === id)?.label;
}

export async function generateStoryIdea(input: StoryIdeaInput): Promise<StoryIdea> {
  const hint = String(input.hint ?? "").trim().slice(0, 400);
  const lead = String(input.lead ?? "").trim().slice(0, 200);
  const opposite = String(input.opposite ?? "").trim().slice(0, 200);
  const setting = String(input.setting ?? "").trim().slice(0, 200);
  const category = String(input.category ?? "surprise").trim() || "surprise";
  const combined = [directionLabel(category) ?? category, hint, lead, opposite, setting].filter(Boolean).join(" ");
  if (combined) {
    const incoming = moderateText(combined, "story_idea_hint");
    if (incoming.verdict === "block") {
      const error = new Error(incoming.reason);
      error.name = "PolicyError";
      throw error;
    }
  }

  const idea = await completeIdea({ hint, category, lead, opposite, setting });
  const locked = applyLocks(idea, { lead, opposite, setting });
  const outgoing = moderateText(`${locked.title}\n${locked.brief}`, "story_idea");
  if (outgoing.verdict === "block") {
    return applyLocks(pickFallback(category), { lead, opposite, setting });
  }
  return locked;
}

async function completeIdea(input: {
  hint: string;
  category: string;
  lead: string;
  opposite: string;
  setting: string;
}): Promise<StoryIdea> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) {
    throw Object.assign(new Error("Story writing is not configured."), { name: "ConfigError" });
  }

  const label = directionLabel(input.category);
  const user = [
    label && label !== "Surprise me"
      ? `Category: ${label}. Stay inside this trope and make the people specific.`
      : "No category lock. Pick the commercially hottest trope that fits the locks below, or invent a hot one if nothing is locked.",
    input.hint ? `User idea (law): ${input.hint}` : "No idea lock. Invent a fresh hook. Do not reuse a famous plot beat-for-beat.",
    input.lead ? `Lead (law): ${input.lead}` : "No lead lock. Invent a specific adult with a job, an age, and a wound.",
    input.opposite
      ? `The person they collide with (law): ${input.opposite}`
      : "No opposite lock. Invent the person who can take the lead's power away in one line.",
    input.setting ? `Setting (law): ${input.setting}` : "No setting lock. Invent 1–2 contemporary interiors we can shoot forever.",
    `Variety seed: ${Date.now() % 9973}`,
  ].join("\n");

  let lastStatus = 0;
  let lastBody = "";
  for (const model of IDEA_MODELS) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "http-referer": "https://dramaspacestudio.com",
        "x-title": "Takehaus",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
    const text = await response.text();
    lastStatus = response.status;
    lastBody = text.slice(0, 240);
    if (!response.ok) {
      console.error(`story-idea ${model} ${response.status}: ${lastBody}`);
      continue;
    }
    try {
      const body = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(extractJson(content)) as Partial<StoryIdea>;
      const title = String(parsed.title ?? "").trim();
      const brief = String(parsed.brief ?? "").trim();
      if (title.length < 3 || brief.length < 80) {
        console.error(`story-idea ${model} thin: ${title} / ${brief.slice(0, 80)}`);
        continue;
      }
      return {
        title: title.slice(0, 80),
        brief: brief.slice(0, 1600),
        category: String(parsed.category ?? input.category),
      };
    } catch (error) {
      console.error(`story-idea ${model} parse: ${error instanceof Error ? error.message : "bad json"}`);
    }
  }
  console.error(`story-idea exhausted ${lastStatus}: ${lastBody}`);
  throw Object.assign(new Error("Could not write the story."), { name: "UpstreamError" });
}

function applyLocks(
  idea: StoryIdea,
  locks: { lead: string; opposite: string; setting: string },
): StoryIdea {
  const extras: string[] = [];
  if (locks.lead && !containsLock(idea.brief, locks.lead)) extras.push(`Cast lock: ${locks.lead}`);
  if (locks.opposite && !containsLock(idea.brief, locks.opposite)) extras.push(`Opposite lock: ${locks.opposite}`);
  if (locks.setting && !containsLock(idea.brief, locks.setting)) extras.push(`Setting lock: ${locks.setting}`);
  if (!extras.length) return idea;
  return { ...idea, brief: `${idea.brief}\n\n${extras.join("\n")}`.slice(0, 1600) };
}

function containsLock(brief: string, lock: string): boolean {
  const tokens = lock
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 4);
  if (!tokens.length) return true;
  const hay = brief.toLowerCase();
  return tokens.some((token) => hay.includes(token));
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
