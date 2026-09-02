import { VISION_MODEL, VISION_PRICE } from "../config/models.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
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

/**
 * What a location plate looks like, in words a video model can hold onto.
 * The plate itself is never sent to the video model for singles (extra image
 * references cost identity in the bake-off); this description is.
 */
export type LocationNotes = {
  /** One sentence: room, palette, key light direction and colour, two dressing anchors. */
  lighting_lock: string;
  palette: string;
  key_light: string;
  dressing: string[];
  model: string;
};

/** Face position in a still, normalised 0–1 relative to the image. */
export type FaceBox = { x: number; y: number; width: number; height: number; confidence: number };

export interface VisionEngine {
  judgeIdentity(input: IdentityJudgeInput): Promise<IdentityJudgement>;
  describeLocation?(input: { plate: Uint8Array; plateMime?: string; location: string }): Promise<LocationNotes>;
  /** Where the (single) face is in a character still; null when none is visible. */
  locateFace?(input: { image: Uint8Array; imageMime?: string }): Promise<FaceBox | null>;
}

const FACE_RUBRIC = `You locate the face in a character reference still.
Answer only with JSON: {"found": true|false, "x": <0..1>, "y": <0..1>, "width": <0..1>, "height": <0..1>, "confidence": <0..1>}.
x,y is the top-left of the tightest box around the face only: top of the forehead (below the hair) to the bottom of the chin, ear to ear. Exclude hair, neck and shoulders. Fractions of image width and height. If no face is visible, found=false. Never explain.`;

export function parseFaceBox(content: string): FaceBox | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  if (raw.found === false) return null;
  const num = (key: string) => (typeof raw[key] === "number" ? (raw[key] as number) : Number(raw[key]));
  const box = { x: num("x"), y: num("y"), width: num("width"), height: num("height"), confidence: clamp01(raw.confidence ?? 0.5) };
  if (![box.x, box.y, box.width, box.height].every((v) => Number.isFinite(v))) return null;
  if (box.width <= 0.02 || box.height <= 0.02 || box.width > 1 || box.height > 1) return null;
  return {
    x: Math.min(1, Math.max(0, box.x)),
    y: Math.min(1, Math.max(0, box.y)),
    width: Math.min(1, box.width),
    height: Math.min(1, box.height),
    confidence: box.confidence,
  };
}

const LOCATION_RUBRIC = `You are a cinematographer writing a lighting continuity note from one establishing still.
Answer only with JSON: {"palette": "<3-5 words>", "key_light": "<direction, colour temperature, hardness in one phrase>", "dressing": ["<anchor>", "<anchor>"], "lighting_lock": "<one sentence a video model can follow to keep every close-up in this exact room and light>"}.
Rules: name real visible things only; no people; no brands or readable text; keep lighting_lock under 40 words.`;

export function parseLocationNotes(content: string, model: string): LocationNotes {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  const dressing = Array.isArray(raw.dressing) ? raw.dressing.filter((row): row is string => typeof row === "string").slice(0, 4) : [];
  const lock = typeof raw.lighting_lock === "string" ? raw.lighting_lock.trim() : "";
  if (!lock) throw new Error("location note missing lighting_lock");
  return {
    lighting_lock: lock.slice(0, 320),
    palette: typeof raw.palette === "string" ? raw.palette.slice(0, 80) : "",
    key_light: typeof raw.key_light === "string" ? raw.key_light.slice(0, 120) : "",
    dressing,
    model,
  };
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
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
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: RUBRIC },
            { role: "user", content: parts },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the identity judgement");
      return parseIdentityJudgement(content, model);
    },

    async describeLocation(input) {
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: LOCATION_RUBRIC },
            {
              role: "user",
              content: [
                { type: "text", text: `Location: ${input.location}.` },
                { type: "image_url", image_url: { url: dataUrl(input.plate, input.plateMime ?? "image/png") } },
              ],
            },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the location note");
      return parseLocationNotes(content, model);
    },

    async locateFace(input) {
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: FACE_RUBRIC },
            { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(input.image, input.imageMime ?? "image/jpeg") } }] },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the face box");
      return parseFaceBox(content);
    },
  };
}
