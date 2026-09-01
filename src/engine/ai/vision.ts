import { VISION_MODEL } from "../config/models.ts";
import { openRouterJson, openRouterProvider } from "./openrouter.ts";

/**
 * Identity judgement for one take against the locked CU still. The mean-RGB
 * distance this replaces could not tell a stranger in the same wardrobe from
 * the cast member, and read a lighting change as a new person. A vision model
 * with a fixed rubric answers the two questions the cut actually needs: how
 * many faces are in frame, and is the pictured face the same person as the
 * reference.
 */
export type IdentityJudgement = {
  /** 0–1. 1 = unmistakably the same person as the reference. */
  same_person: number;
  /** Faces visible across the sampled frames (max over frames). */
  face_count: number;
  /** Short model rationale, kept for the audit trail. */
  notes: string;
  model: string;
};

export type IdentityJudgeInput = {
  /** Locked CU still (PNG/JPEG bytes). Null when the take has no pictured cast member. */
  reference: Uint8Array | null;
  referenceMime?: string;
  /** Frames sampled from the take, in time order. */
  frames: Uint8Array[];
  frameMime?: string;
  /** How many people the plan put in this shot: 0 for an empty wide, 1 for a single. */
  expectedFaces: number;
  /** Cast description used to break ties on hair/scar/wardrobe. */
  description?: string | null;
};

export interface VisionEngine {
  judgeIdentity(input: IdentityJudgeInput): Promise<IdentityJudgement>;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const RUBRIC = `You are a continuity supervisor checking generated footage against a locked cast reference.
Answer only with JSON: {"face_count": <integer>, "same_person": <0..1 number>, "notes": "<one sentence>"}.
Rules:
- face_count is the maximum number of distinct human faces or bodies visible in any of the sampled frames. Count partial bodies, silhouettes, and reflections that read as a person.
- same_person compares the main pictured face to the reference: 1.0 = same individual (bone structure, eyes, nose, distinguishing marks). 0.5 = could be, uncertain. 0.0 = a different person. Ignore lighting, camera angle, expression, and small wardrobe changes; do not ignore a different face shape, missing scar, different hair color, or different age.
- If there is no reference, set same_person to 1.0 and judge only face_count.
- Never explain outside the JSON.`;

function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function parseIdentityJudgement(content: string, model: string): IdentityJudgement {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  const count = typeof raw.face_count === "number" ? raw.face_count : Number(raw.face_count);
  return {
    same_person: clamp01(raw.same_person),
    face_count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 240) : "",
    model,
  };
}

export function createOpenRouterVision(model = VISION_MODEL): VisionEngine {
  return {
    async judgeIdentity(input) {
      if (!input.frames.length) throw new Error("Identity judgement needs at least one frame");
      const parts: Array<Record<string, unknown>> = [];
      parts.push({
        type: "text",
        text: `Expected people in frame: ${input.expectedFaces}.${input.description ? ` Cast note: ${input.description}` : ""}${
          input.reference ? " The first image is the locked reference; the rest are frames from the take in time order." : " No reference: judge face_count only."
        }`,
      });
      if (input.reference) {
        parts.push({ type: "image_url", image_url: { url: dataUrl(input.reference, input.referenceMime ?? "image/png") } });
      }
      for (const frame of input.frames) {
        parts.push({ type: "image_url", image_url: { url: dataUrl(frame, input.frameMime ?? "image/jpeg") } });
      }
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: RUBRIC },
            { role: "user", content: parts },
          ],
        }),
      });
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the identity judgement");
      return parseIdentityJudgement(content, model);
    },
  };
}
