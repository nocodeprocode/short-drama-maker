import { VISION_MODEL, VISION_PRICE } from "../config/models.ts";
import { imageDataUrl } from "../media/image-mime.ts";
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
  /** Any human figure at all: face, silhouette, back to camera, reflection, portrait on a wall. */
  people_present: boolean;
  /** Floor plan in one sentence: main surface and its height, window wall, shelf wall, floor. */
  geometry?: string;
  model: string;
};

/** Face position in a still, normalised 0–1 relative to the image. */
export type FaceBox = { x: number; y: number; width: number; height: number; confidence: number };

export interface VisionEngine {
  judgeIdentity(input: IdentityJudgeInput): Promise<IdentityJudgement>;
  describeLocation?(input: { plate: Uint8Array; plateMime?: string; location: string }): Promise<LocationNotes>;
  /** Where the (single) face is in a character still; null when none is visible. */
  locateFace?(input: { image: Uint8Array; imageMime?: string }): Promise<FaceBox | null>;
  /** Phone-close beauty / modest clothes on a NEW character still. */
  judgeCastLook?(input: { image: Uint8Array; imageMime?: string }): Promise<CastLookJudgement>;
  /** One-sentence blocking note from a last frame: sides, hands, prop place. */
  describeBlocking?(input: { frame: Uint8Array; frameMime?: string; names: string[] }): Promise<string>;
}

export type CastLookJudgement = {
  beauty: boolean;
  close: boolean;
  modest: boolean;
  notes: string;
  model: string;
};

const CAST_LOOK_RUBRIC = `You judge a short-drama character still for phone-close beauty.
Answer only with JSON: {"beauty": true|false, "close": true|false, "modest": true|false, "notes": "<one sentence>"}.
beauty is true only if the face is strikingly beautiful and camera-ready — not tired, plain, average, or unremarkable.
close is true only if the face is FaceTime-close or closer (eyes readable, head-and-shoulders or tighter), not a wide or full-body.
modest is true if clothes are on and opaque.
Fictional adult. Never explain outside the JSON.`;

export function parseCastLook(content: string, model: string): CastLookJudgement {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  const flag = (key: string) => raw[key] === true || raw[key] === "true";
  return {
    beauty: flag("beauty"),
    close: flag("close"),
    modest: raw.modest === false || raw.modest === "false" ? false : true,
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 240) : "",
    model,
  };
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
Answer only with JSON: {"people_present": true|false, "palette": "<3-5 words>", "key_light": "<direction, colour temperature, hardness in one phrase>", "dressing": ["<anchor>", "<anchor>"], "lighting_lock": "<one sentence a video model can follow to keep every close-up in this exact place and light>", "geometry": "<one sentence of real geography>"}.
people_present is true if ANY human figure is visible in any form: a face, a body, a silhouette, someone with their back to camera, a reflection, a mannequin, or a person in a painting or photograph on the wall. Be strict.
If the still is OUTDOOR (alley, street, rain, pavement): geometry names the wall, the ground, the light (street lamp or window), the opening, and that there are no indoor curtains or furniture in the street. lighting_lock must not invent a room.
If the still is INDOOR: geometry is the floor plan — the main surface, window side, shelves, floor material. lighting_lock must not invent open sky or rain inside.
Rules: name real visible things only; no brands or readable text; keep lighting_lock under 40 words and geometry under 45 words.`;

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
    people_present: raw.people_present === true || raw.people_present === "true",
    geometry: typeof raw.geometry === "string" && raw.geometry.trim() ? raw.geometry.trim().slice(0, 320) : undefined,
    model,
  };
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
};

export const IDENTITY_RUBRIC = `You are a continuity supervisor checking generated footage against a locked cast reference.
Answer only with JSON: {"face_count": <integer>, "same_person": <0..1 number>, "notes": "<one sentence>"}.
Rules:
- face_count is the maximum number of distinct human faces or bodies visible in any of the sampled frames. Count partial bodies, silhouettes, and reflections that read as a person.
- same_person compares the main pictured face to the reference: 1.0 = same individual (bone structure, eyes, nose, distinguishing marks). 0.5 = could be, uncertain. 0.0 = a different person. If race, skin tone, or hair family changed versus the reference still, same_person is 0. Ignore lighting, camera angle, expression, and small wardrobe changes; do not ignore a different face shape, missing scar, different hair color, different age, or a race/skin recast.
- If there is no reference, set same_person to 1.0 and judge only face_count.
- Never explain outside the JSON.`;

const RUBRIC = IDENTITY_RUBRIC;

function dataUrl(bytes: Uint8Array, mime?: string): string {
  return imageDataUrl(bytes, mime);
}

function clamp01(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function parseBlockingNote(content: string): string {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  const note = typeof raw.note === "string" ? raw.note.trim() : trimmed;
  if (!note) throw new Error("blocking note missing");
  return note.slice(0, 240);
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

    async describeBlocking(input) {
      const who = input.names.filter(Boolean).join(" and ") || "the two people";
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            {
              role: "system",
              content:
                "You are a script supervisor writing a blocking note from the last frame of a scene. Answer only with JSON: {\"note\": \"<one sentence>\"}. Name who is camera-left and camera-right, what each is doing with their hands, and where the prop sits. No brands. No readable text. Under 40 words.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `Named people: ${who}.` },
                { type: "image_url", image_url: { url: dataUrl(input.frame, input.frameMime ?? "image/jpeg") } },
              ],
            },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the blocking note");
      return parseBlockingNote(content);
    },

    async judgeCastLook(input) {
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: CAST_LOOK_RUBRIC },
            { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(input.image, input.imageMime ?? "image/jpeg") } }] },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no text for the cast-look judgement");
      return parseCastLook(content, model);
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
