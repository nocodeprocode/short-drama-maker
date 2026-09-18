import { moderateText } from "./moderation.ts";
import { isEpisodeLength, SECONDS_PER_EPISODE } from "./skus.ts";

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
  episode_count?: number;
  episode_length?: string;
};

export type StoryIdeaProgress = Pick<StoryIdea, "title" | "brief">;

export type SeasonOrder = { episodes: number; seconds: number };

/**
 * The order the buyer is paying for. The writer has to size the spine to it: a
 * 15-episode engine and a 90-episode engine are different shows, and a brief
 * that never sees the count writes episode 1 and stops.
 */
export function seasonOrder(count: unknown, length: unknown): SeasonOrder {
  const asked = Math.round(Number(count));
  const episodes = Number.isFinite(asked) && asked > 0 ? Math.min(90, Math.max(15, asked)) : 30;
  return {
    episodes,
    seconds: isEpisodeLength(length) ? SECONDS_PER_EPISODE[length] : SECONDS_PER_EPISODE["60_90"],
  };
}

/** Same writer family as the production bible. Sonnet is the fallback if Opus is dark. */
const IDEA_MODELS = ["anthropic/claude-opus-5", "anthropic/claude-sonnet-4.6"] as const;

const SYSTEM = `You invent original vertical short-drama series for Takehaus. The brief you write is the only story the production bible will see, so it has to be a show someone would actually watch tonight.

This is a coin-pack advertisement, not a prestige pilot. Write like an ad copywriter who understands ReelShort / DramaBox heat.

Hard rules:
- Every character is fictional and an adult. Never use a real person's name or likeness.
- Never write a minor, not even in passing. The safety gate rejects the words for children and throws the whole draft away. Land a hidden-child twist on an adult (a grown heir, a daughter who is now 30) or on an object (a birth record, a paternity result).
- You are given the exact season order. Write that whole season, not one episode and not a feature film.
- Name the season engine: the renewable pressure that forces a fresh confrontation every episode, and the ladder that raises the cost as the order runs. A 15-episode order needs a spine that survives 15 turns; a 90-episode order needs one that survives 90. If the engine is spent after episode 1, it is the wrong engine.
- One core expectation in a single sentence. The plot is the delay mechanism, not the promise.
- If it is a love story — almost all of these are — the leads meet in episode 1.
- Episode 1 opens at the height of the conflict. No runway. No drive home.
- Episode 1 ends on a CPI moment: a consequence starting, not a question being asked. Increase tension, never resolve it.
- Name the lead and the person they collide with. Give them a power imbalance the viewer can feel in one line.
- The setting is a specific contemporary interior we can lock (a named hospital floor, a penthouse, a family estate, a hotel, a firm). Not "a city." Prefer rooms over crowds, period, fantasy, or transformations.
- Titles are 2 to 6 words, specific, trope-legible. Never generic ("The Secret", "Love Again", "Broken Vows").
- No sexual content, no minors, no celebrities, no real brands as villains.
- If the user locked a lead, opposite, setting, or idea, those are law. Escalate them. Do not replace them with a stock plot.
- If they locked nothing, invent a commercially hot premise that feels current this week — a specific people-and-room version of a live trope (hidden identity, contract marriage, revenge, a hidden adult heir, second chance, family secret). Do not recite a famous plot beat-for-beat.
- The brief is a complete 8 to 12 sentence story treatment. Include: who they are, the locked rooms, the core expectation, the season engine, the ladder that escalates it across the order, how episode 1 opens, its major turn, how episode 1 ends, and why a stranger would tap the next episode. Finish every sentence and every thought. Never stop mid-sentence.
- Return JSON only: {"title":"...","brief":"...","category":"..."}`;

/**
 * Only reachable when the buyer locked nothing, so a canned premise cannot
 * contradict their people and rooms. Each one carries a renewable engine, not a
 * single episode, and stays clear of the words the safety gate rejects.
 */
export const FALLBACKS: StoryIdea[] = [
  {
    title: "The Night Ledger",
    brief:
      "Mara Voss, 27, is the night auditor at a family-owned hotel who married the heir to keep her mother in treatment. In his locked study she finds a second set of books and a photograph of a wife who is still alive. The rooms are that study, the front desk at 3am, and the owners' floor she cannot badge into. The core expectation: when will he admit the marriage was a cover for the theft. The season engine is the ledger itself: every episode she reconciles one more falsified line, and every line she closes prints the name of another relative who signed it. Each name costs her something she cannot get back, starting with her access and ending with her own signature on a page she never read. Episode 1 opens on her already in the study, not walking down the hall. It turns when the outside auditor she called for help is escorted in as his lawyer. It ends when she hears the study door lock from the outside and his voice, calm, on the other side: the photograph is the least of what he hid. A stranger taps the next episode because she is holding the proof while standing in the room that locks.",
    category: "family_secret",
  },
  {
    title: "Wife on Paper",
    brief:
      "Nadia Ruiz, 29, is a debt-squeezed interior designer who signs a one-year marriage contract with a cold hotel heir who needs a public spouse before a board vote. The rooms are the courthouse counter, the show apartment she is paid to stage, and the boardroom she is not allowed to enter. The core expectation: when will the contract stop being the only thing holding them in the same room. The season engine is the contract's own schedule: every episode triggers one more clause she was never shown, and every clause buys the board another week of his control. She can refuse a clause only by paying its penalty herself, so each refusal pushes her further into the debt she married to escape. Episode 1 opens at the counter with the ring already on. It turns when his mother hands her a copy of the agreement containing a page she has never seen. It ends when the woman who signed this same contract last year walks in and asks Nadia how far she has read. A stranger taps the next episode because the page is in her hand and the vote is nine days out.",
    category: "contract",
  },
  {
    title: "Her Second Name",
    brief:
      "Iris Lang, 31, runs a flower stall until a dying founder stops her in a private hospital corridor and calls her the daughter he hid for thirty years. The rooms are that corridor, the founder's glass office, and the estate dining room where the family eats without her. The core expectation: when will the family who sold her out have to watch her take the company. The season engine is the succession: every episode a different relative produces a document meant to erase her, and every document she survives moves one more vote to her side. Each vote she wins costs her the one person in the last room who was kind to her. Episode 1 opens in that corridor, not at the stall. It turns when the founder's assistant confirms her name was on the register the entire time. It ends at the will reading where her name is already printed, and the legitimate son realizes the paper in his pocket is a copy. A stranger taps the next episode because the original is somewhere in the building and everyone at the table knows it.",
    category: "secret_child",
  },
];

export function directionLabel(id: string | undefined): string | undefined {
  return STORY_DIRECTIONS.find((item) => item.id === id)?.label;
}

/**
 * Only what the buyer typed. The category is our own catalog label, and feeding
 * it to the gate made "Secret child" reject itself before a word was written.
 */
export function buyerText(input: StoryIdeaInput): string {
  return [input.hint, input.lead, input.opposite, input.setting]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export async function generateStoryIdea(
  input: StoryIdeaInput,
  onProgress?: (progress: StoryIdeaProgress) => void | Promise<void>,
): Promise<StoryIdea> {
  const hint = String(input.hint ?? "").trim().slice(0, 400);
  const lead = String(input.lead ?? "").trim().slice(0, 200);
  const opposite = String(input.opposite ?? "").trim().slice(0, 200);
  const setting = String(input.setting ?? "").trim().slice(0, 200);
  const category = String(input.category ?? "surprise").trim() || "surprise";
  const combined = buyerText({ hint, lead, opposite, setting });
  if (combined) {
    const incoming = moderateText(combined, "story_idea_hint");
    if (incoming.verdict === "block") {
      const error = new Error(incoming.reason);
      error.name = "PolicyError";
      throw error;
    }
  }

  const locks = { lead, opposite, setting };
  const order = seasonOrder(input.episode_count, input.episode_length);

  // A rejected draft is rewritten with the reason, never swapped for a canned
  // premise. The buyer locked people and rooms; handing back a different show
  // and calling it theirs is worse than saying no.
  let rejection = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const idea = await completeIdea({ hint, category, lead, opposite, setting, order, rejection }, onProgress);
    const locked = applyLocks(idea, locks);
    const outgoing = moderateText(`${locked.title}\n${locked.brief}`, "story_idea");
    if (outgoing.verdict !== "block") {
      await onProgress?.({ title: locked.title, brief: locked.brief });
      return locked;
    }
    rejection = outgoing.reason;
  }

  if (hint || lead || opposite || setting) {
    throw Object.assign(new Error(rejection), { name: "PolicyError" });
  }
  const fallback = pickFallback(category);
  await onProgress?.({ title: fallback.title, brief: fallback.brief });
  return fallback;
}

async function completeIdea(input: {
  hint: string;
  category: string;
  lead: string;
  opposite: string;
  setting: string;
  order: SeasonOrder;
  rejection: string;
}, onProgress?: (progress: StoryIdeaProgress) => void | Promise<void>): Promise<StoryIdea> {
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
    `Season order (law): ${input.order.episodes} episodes of about ${input.order.seconds} seconds each. The engine must still be generating confrontations at episode ${input.order.episodes}.`,
    input.rejection
      ? `Your previous draft was rejected: ${input.rejection} Rewrite it so it passes, keeping every lock above.`
      : "",
    `Variety seed: ${Date.now() % 9973}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

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
        max_tokens: 2200,
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
    });
    lastStatus = response.status;
    if (!response.ok) {
      lastBody = (await response.text()).slice(0, 240);
      console.error(`story-idea ${model} ${response.status}: ${lastBody}`);
      continue;
    }
    try {
      await onProgress?.({ title: "", brief: "" });
      const content = await readStreamedContent(response, async (partial) => {
        await onProgress?.({
          title: partialJsonString(partial, "title"),
          brief: partialJsonString(partial, "brief"),
        });
      });
      const parsed = JSON.parse(extractJson(content)) as Partial<StoryIdea>;
      const title = String(parsed.title ?? "").trim();
      const brief = String(parsed.brief ?? "").trim();
      if (title.length < 3 || brief.length < 80) {
        console.error(`story-idea ${model} thin: ${title} / ${brief.slice(0, 80)}`);
        continue;
      }
      return {
        title: title.slice(0, 80),
        brief,
        category: String(parsed.category ?? input.category),
      };
    } catch (error) {
      console.error(`story-idea ${model} parse: ${error instanceof Error ? error.message : "bad json"}`);
    }
  }
  console.error(`story-idea exhausted ${lastStatus}: ${lastBody}`);
  throw Object.assign(new Error("Could not write the story."), { name: "UpstreamError" });
}

async function readStreamedContent(
  response: Response,
  onContent: (content: string) => void | Promise<void>,
): Promise<string> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const body = JSON.parse(await response.text()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? "";
    await onContent(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";

  const consume = async (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (event.error?.message) throw new Error(event.error.message);
    const delta = event.choices?.[0]?.delta?.content;
    if (!delta) return;
    content += delta;
    await onContent(content);
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) await consume(line);
    if (done) break;
  }
  if (pending) await consume(pending);
  return content;
}

export function partialJsonString(source: string, key: string): string {
  const match = new RegExp(`"${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"\\s*:\\s*"`).exec(source);
  if (!match) return "";
  let value = "";
  let escaped = false;
  for (let index = (match.index ?? 0) + match[0].length; index < source.length; index += 1) {
    const char = source[index]!;
    if (escaped) {
      value += char === "n" ? "\n" : char === "r" ? "\r" : char === "t" ? "\t" : char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "\"") {
      break;
    } else {
      value += char;
    }
  }
  return value;
}

export function applyLocks(
  idea: StoryIdea,
  locks: { lead: string; opposite: string; setting: string },
): StoryIdea {
  const extras: string[] = [];
  if (locks.lead && !containsLock(idea.brief, locks.lead)) extras.push(`Cast lock: ${locks.lead}`);
  if (locks.opposite && !containsLock(idea.brief, locks.opposite)) extras.push(`Opposite lock: ${locks.opposite}`);
  if (locks.setting && !containsLock(idea.brief, locks.setting)) extras.push(`Setting lock: ${locks.setting}`);
  if (!extras.length) return idea;
  return { ...idea, brief: `${idea.brief}\n\n${extras.join("\n")}` };
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
