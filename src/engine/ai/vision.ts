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
  /** Dummy words on a fixture, or a leaked metaphor prop (padlock, key, slate). */
  placeholder_lettering: boolean;
  /** Visible filmmaking equipment that does not belong inside the story world. */
  production_gear_present: boolean;
  /** Floor plan in one sentence: main surface and its height, window wall, shelf wall, floor. */
  geometry?: string;
  model: string;
};

export type PlaceContinuityJudgement = {
  consistent: boolean;
  camera_correct: boolean;
  notes: string;
  model: string;
};

/** Face position in a still, normalised 0–1 relative to the image. */
export type FaceBox = { x: number; y: number; width: number; height: number; confidence: number };

export interface VisionEngine {
  judgeIdentity(input: IdentityJudgeInput): Promise<IdentityJudgement>;
  describeLocation?(input: { plate: Uint8Array; plateMime?: string; location: string }): Promise<LocationNotes>;
  judgePlaceContinuity?(input: {
    master: Uint8Array;
    masterMime?: string;
    layout?: Uint8Array | null;
    layoutMime?: string;
    candidate: Uint8Array;
    candidateMime?: string;
    location: string;
    angle: string;
  }): Promise<PlaceContinuityJudgement>;
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
  production_gear_present?: boolean;
  production_gear_evidence?: string;
  /** False when the irises glow, emit light, or do not match each other. */
  eyes_natural?: boolean;
  eye_evidence?: string;
  /** How far the head is actually turned, counted from the visible eyes. */
  head_turn?: "front" | "three_quarter" | "profile";
  notes: string;
  model: string;
};

const CAST_LOOK_RUBRIC = `You judge a short-drama character still for phone-close beauty.
Answer only with JSON: {"beauty": true|false, "close": true|false, "modest": true|false, "production_gear_present": true|false, "production_gear_evidence": "<visible object and its position, or empty>", "eyes_natural": true|false, "eye_evidence": "<what is wrong with the eyes, or empty>", "head_turn": "front"|"three_quarter"|"profile", "notes": "<one sentence>"}.
beauty is true only if the face is strikingly beautiful and camera-ready — not tired, plain, average, or unremarkable.
close is true only if the face is FaceTime-close or closer (eyes readable, head-and-shoulders or tighter), not a wide or full-body.
modest is true if clothes are on and opaque.
production_gear_present is true only if unmistakable filmmaking equipment is visibly inside the image pixels: a studio lamp, LED panel, softbox, light stand, tripod, reflector, camera, cable, backdrop edge, boom, or monitor. Do not infer equipment from professional lighting. A clean seamless backdrop is allowed. If uncertain, answer false. When true, production_gear_evidence must name the visible object and where it appears; otherwise it must be empty.
eyes_natural is false if the irises glow, emit or radiate light, look luminous or backlit, read as LED or neon, or if the two eyes are different colours as heterochromia. It is also false when a pale iris stays brighter than the lit skin of the same face, or keeps its colour while the face around it falls into shadow: a real iris darkens with the light on it. This is a human being, not a creature: a small catchlight reflection is fine, a lit-up iris is not. If eyes_natural is false, eye_evidence must say which eye and what is wrong; otherwise it must be empty. If the eyes are not visible, answer true.
head_turn is counted from the eyes, not from the shoulders or the gaze. "front" means both eyes sit fully inside the face with the nose between them. "three_quarter" means both eyes are still visible but the far one is pushed towards the edge of the cheek. "profile" means only ONE eye is visible because the head is turned a full 90 degrees and the nose, lips and chin read as an outline against the background. A head that shows two eyes is never profile, however far the gaze is thrown.
Fictional adult. Never explain outside the JSON.`;

/** Undefined for anything the model did not answer: a missing turn is not a defect. */
function parseHeadTurn(value: unknown): CastLookJudgement["head_turn"] {
  const word = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (word === "front" || word === "three_quarter" || word === "profile") return word;
  return undefined;
}

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
    production_gear_present: raw.production_gear_present === true || raw.production_gear_present === "true",
    production_gear_evidence:
      typeof raw.production_gear_evidence === "string" ? raw.production_gear_evidence.slice(0, 160) : "",
    // Absent means the model did not answer, which must not read as a defect.
    eyes_natural: raw.eyes_natural === false || raw.eyes_natural === "false" ? false : true,
    eye_evidence: typeof raw.eye_evidence === "string" ? raw.eye_evidence.slice(0, 160) : "",
    head_turn: parseHeadTurn(raw.head_turn),
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
Answer only with JSON: {"people_present": true|false, "placeholder_lettering": true|false, "production_gear_present": true|false, "palette": "<3-5 words>", "key_light": "<direction, colour temperature, hardness in one phrase>", "dressing": ["<anchor>", "<anchor>"], "lighting_lock": "<one sentence a video model can follow to keep every close-up in this exact place and light>", "geometry": "<one sentence of real geography>"}.
people_present is true if ANY human figure is visible in any form: a face, a body, a silhouette, someone with their back to camera, a reflection, a mannequin, or a person in a painting or photograph on the wall. Be strict.
placeholder_lettering is true if any fixture shows dummy or leaked copy: LOCATION, SAMPLE, LOREM, TEST, INSERT, PLATE, 9:16, garbled lettering, or the name of the place written as a title. A real floor number such as 10 is not dummy copy. Also true if a padlock, key, chain, clapperboard, or film slate is sitting in the place as a prop.
production_gear_present is true if ANY filmmaking apparatus is visible: a studio lamp or LED panel, light stand, tripod, C-stand, softbox, reflector, boom microphone, camera, cable, green screen, backdrop support, sandbag, monitor, dolly, or crew gear. Ordinary in-world chandeliers, ceiling lights, desk lamps, street lamps, and architectural fixtures are allowed.
If the still is OUTDOOR (alley, street, rain, pavement, a parked car): geometry names the wall or the car, the ground, the light (street lamp or window), the opening, and that there are no indoor curtains or furniture in the street. lighting_lock must not invent a room.
If the location is a car and the still is a furnished room, placeholder_lettering is true — a car does not belong in a living room.
If the still is INDOOR: geometry is the floor plan — the main surface, window side, shelves, floor material. lighting_lock must not invent open sky or rain inside.
If the location is an elevator or lift: this is a closed passenger cab. placeholder_lettering is also true if the still shows a window, an outdoor view, sky, a city through glass, rain on glass, or a hotel corridor posing as a cab. geometry names the closed doors, panel walls, handrail, ceiling light, and that there is no window.
Rules: name real visible things only; no brands or readable text; keep lighting_lock under 40 words and geometry under 45 words.`;

export const PLACE_CONTINUITY_RUBRIC = `You are a strict set-continuity supervisor.
Image 1 is the master set. Image 2, when present, is its authoritative overhead layout. The final image is a requested new camera angle.
Answer only with JSON: {"consistent": true|false, "camera_correct": true|false, "notes": "<one sentence>"}.
consistent is true only when the final image can be the same physical room with the camera moved or panned as requested.
Reject if a table, chair group, door, window, cabinet, wall feature, or fixture moved, rotated within the floor plan, mirrored, changed sides, changed count materially, or changed identity.
Perspective may change apparent angles and sizes. A camera rotation is allowed; rotating or rearranging the furniture is not.
camera_correct is true only when the final image actually performs the requested direction. Opposite must show the reverse 180-degree field, left and right must show their respective 90-degree fields, facing must retain the master direction, and overhead must be genuinely straight down. A duplicate or lightly reframed master is false for opposite, left, right, or overhead.
For an overhead candidate, reject unless its layout plausibly preserves all visible anchors and their orientation from the master.
Never explain outside the JSON.`;

export function parsePlaceContinuity(content: string, model: string): PlaceContinuityJudgement {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>;
  return {
    consistent: raw.consistent === true || raw.consistent === "true",
    camera_correct: raw.camera_correct === true || raw.camera_correct === "true",
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 240) : "",
    model,
  };
}

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
    placeholder_lettering: raw.placeholder_lettering === true || raw.placeholder_lettering === "true",
    production_gear_present: raw.production_gear_present === true || raw.production_gear_present === "true",
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

    async judgePlaceContinuity(input) {
      const images: Array<Record<string, unknown>> = [
        { type: "text", text: `Location: ${input.location}. Requested angle: ${input.angle}.` },
        { type: "image_url", image_url: { url: dataUrl(input.master, input.masterMime ?? "image/png") } },
      ];
      if (input.layout) {
        images.push({ type: "image_url", image_url: { url: dataUrl(input.layout, input.layoutMime ?? "image/png") } });
      }
      images.push({ type: "image_url", image_url: { url: dataUrl(input.candidate, input.candidateMime ?? "image/png") } });
      const body = await openRouterJson<ChatResponse>("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          usage: { include: true },
          provider: openRouterProvider("text"),
          messages: [
            { role: "system", content: PLACE_CONTINUITY_RUBRIC },
            { role: "user", content: images },
          ],
        }),
      }, { idempotent: true });
      costMeter.record(openRouterUsageCost(body.usage, VISION_PRICE, "vision"));
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenRouter returned no place-continuity judgement");
      return parsePlaceContinuity(content, model);
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
