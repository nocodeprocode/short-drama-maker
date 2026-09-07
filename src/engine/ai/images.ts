import { IMAGE_MODEL, IMAGE_PRICE } from "../config/models.ts";
import { honestImageMime, imageDataUrl } from "../media/image-mime.ts";
import type { ImageEngine } from "./types.ts";
import { placePlateDressing, placePlateLead } from "../../drama-engine/craft/place.ts";
import { MODEST_DRESS_RULE } from "./modesty.ts";
import { providerFetch } from "./http.ts";
import { costMeter, openRouterUsageCost } from "./meter.ts";
import { openRouterJson, openRouterProvider } from "./openrouter.ts";

type ImageResponse = {
  data?: Array<{ b64_json?: string; url?: string; media_type?: string }>;
  usage?: { cost?: number };
};

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

const ALLOWED_IMAGE_HOSTS = ["openrouter.ai", "openrouterusercontent.com"];

function assertSafeImageUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("OpenRouter image URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("OpenRouter image URL must be https");
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_IMAGE_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  if (!allowed) {
    throw new Error(`Refusing to fetch image from unlisted host ${host}`);
  }
}

export type ImageRef = { bytes: Uint8Array; mime_type: string };

function refPart(ref: ImageRef): Record<string, unknown> {
  return {
    type: "image_url",
    image_url: { url: imageDataUrl(ref.bytes, ref.mime_type) },
  };
}

/**
 * `seed` accepts an array so a blocking still can be composited from the face
 * still plus the location plate. Reference order is meaningful to the model:
 * pass the image whose content should dominate first.
 */
async function requestImage(
  prompt: string,
  seed?: ImageRef | ReadonlyArray<ImageRef>,
): Promise<{ bytes: Uint8Array; mime_type: string }> {
  const refs = seed ? (Array.isArray(seed) ? seed : [seed as ImageRef]) : [];
  const body = await openRouterJson<ImageResponse>("/images", {
    method: "POST",
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      aspect_ratio: "9:16",
      output_format: "png",
      provider: openRouterProvider(),
      ...(refs.length > 0 ? { input_references: refs.map(refPart) } : {}),
    }),
  }, { idempotent: true });
  costMeter.record(openRouterUsageCost(body.usage, IMAGE_PRICE, "image"));
  const image = body.data?.[0];
  if (image?.b64_json) {
    const bytes = decodeBase64(image.b64_json);
    return {
      bytes,
      mime_type: honestImageMime(bytes, image.media_type ?? "image/png"),
    };
  }
  if (image?.url) {
    assertSafeImageUrl(image.url);
    const response = await providerFetch(image.url, {}, { provider: "openrouter-cdn", timeoutMs: 60_000 });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      mime_type: honestImageMime(bytes, response.headers.get("content-type") ?? image.media_type ?? "image/png"),
    };
  }
  throw new Error("OpenRouter image response contained no image data");
}

export function createOpenRouterImages(): ImageEngine {
  return {
    async generateReference(input) {
      if (input.kind === "object_insert" || input.kind === "phone_ui") {
        return requestImage(
          [
            "Photorealistic vertical 9:16 evidence insert still.",
            "NO people, NO faces, NO couple, NO second person, NO body, no portrait, no hands unless already on the object.",
            input.description,
            "Single object, documentary lighting, tight crop. Keep any printed date or name on the object readable.",
            "Do not render any on-image title, caption, watermark, or the words evidence, insert, still, or 9:16.",
          ].join(" "),
        );
      }
      if (input.kind === "location") {
        // A plate is a place, not a character. The lead line follows the
        // location: an alley is an exterior, a kitchen is a room. Calling
        // every plate an interior is how curtains appear in the street.
        return requestImage(
          [
            placePlateLead(input.characterName),
            input.description,
            "One motivated key light, cinematic colour grade, finished location — not a soundstage missing a wall.",
            placePlateDressing(input.characterName),
            "No text, no signage, no logos, no captions, no watermark.",
          ].join(" "),
        );
      }
      const tight = input.kind === "cu" || input.kind === "front" || input.kind === "three_quarter" || input.kind === "profile";
      return requestImage(
        [
          tight
            ? "Photorealistic vertical 9:16 HEAD-AND-SHOULDERS close-up. Face fills the frame. Cropped at the chest. NOT a full-body standing pose. NOT a wide master."
            : "Photorealistic vertical 9:16 character reference still, FaceTime-close.",
          // create-engine/face-screen rejects a NEW still that fails CAST_LOOK; old locked PNGs are not recut.
          "Short-drama lead: strikingly beautiful adult, camera-ready, the kind of face a viewer pauses for. Clear skin, defined features, catchlight in the eyes. Flattering, not tired, not plain.",
          `Character: ${input.characterName}.`,
          input.description,
          `Pose / framing: ${input.kind}.`,
          MODEST_DRESS_RULE,
          "Fictional adult. Do not copy a public figure. Neutral set lighting. Single subject. ONE person only. Same wardrobe as described.",
          "Ignore any sleepwear, bare-leg, or underdressed wardrobe in the character notes. Dress them modestly instead.",
        ].join(" "),
      );
    },
    async generateReferenceFromSeed(input) {
      if (input.kind === "location") {
        return requestImage(
          [
            placePlateLead(input.characterName),
            "Same place as the reference still. Same walls, same ground, same light. A new angle of that place, not a new place.",
            input.description,
            placePlateDressing(input.characterName),
            "No text, no signage, no logos, no captions, no watermark.",
          ].join(" "),
          { bytes: input.seed_bytes, mime_type: input.seed_mime_type },
        );
      }
      const tight = input.kind === "cu" || input.kind === "front" || input.kind === "three_quarter";
      return requestImage(
        [
          tight
            ? "Same person as the reference photo. Tight vertical 9:16 HEAD-AND-SHOULDERS close-up. Face fills the frame. Cropped at the chest. NOT full body. NOT a second person."
            : "Photorealistic vertical 9:16 character reference still, FaceTime-close.",
          "Keep the same strikingly beautiful adult face. Flattering, camera-ready, catchlight in the eyes.",
          input.replaceWardrobe
            ? `Same face, hair, age, and identifying marks as the reference. REPLACE the clothing. New wardrobe only: ${input.replaceWardrobe}. Do not copy sheer, thin, or see-through fabric. No undergarment line.`
            : "Keep the same face, hair, age, and wardrobe as the reference photo. No costume change.",
          `Character: ${input.characterName}.`,
          input.description,
          `Pose / framing: ${input.kind}.`,
          MODEST_DRESS_RULE,
          "Adult only. Do not copy a public figure. Neutral set lighting. Single subject.",
          "Ignore any sleepwear, bare-leg, or underdressed wardrobe in the notes. Dress them modestly instead.",
        ].join(" "),
        { bytes: input.seed_bytes, mime_type: input.seed_mime_type },
      );
    },
    async generateBlockingStill(input) {
      return requestImage(
        [
          "Photorealistic vertical 9:16 film frame.",
          "Reference image 1 is the ACTOR. Reference image 2 is the SET.",
          `Place the person from image 1 inside the room from image 2. ${input.framing}.`,
          "IDENTITY LOCK: keep the exact face, hair, skin tone, age and wardrobe from image 1. Do not restyle the face. Do not swap the person.",
          "SET LOCK: keep the exact room, furniture, wall colour, window positions, key light direction and colour grade from image 2. Do not invent a new room. Do not change the time of day.",
          input.locationNote?.trim() ? `Lighting: ${input.locationNote.trim()}` : "",
          `Character: ${input.characterName}. ${input.description}`,
          MODEST_DRESS_RULE,
          "ONE person only. No second person, no reflection of another person, no crowd.",
          "Relight the person to match the room's key light so they belong in the space.",
          "No text, no captions, no watermark, no logos, no readable signage.",
        ]
          .filter(Boolean)
          .join(" "),
        [
          { bytes: input.face_bytes, mime_type: input.face_mime_type },
          { bytes: input.plate_bytes, mime_type: input.plate_mime_type },
        ],
      );
    },
    async generateBlockingStillFromPlate(input) {
      return requestImage(
        [
          "Photorealistic vertical 9:16 film frame.",
          "The reference image is the SET. Keep that exact room, furniture, wall colour, windows, key light and grade.",
          `Place ONE person in that room. ${input.framing}.`,
          `Character: ${input.characterName}. ${input.description}`,
          "IDENTITY LOCK: the person must match that description exactly. Same face, hair, age, wardrobe. Do not invent a different person.",
          input.locationNote?.trim() ? `Lighting: ${input.locationNote.trim()}` : "",
          MODEST_DRESS_RULE,
          "ONE person only. Relight them to the room's key light.",
          "No text, no captions, no watermark, no logos, no readable signage.",
        ]
          .filter(Boolean)
          .join(" "),
        { bytes: input.plate_bytes, mime_type: input.plate_mime_type },
      );
    },
    async generateCover(input) {
      return requestImage(
        [
          "Photorealistic vertical 9:16 series key art for a short drama.",
          `Series title for mood only, do not render any text: ${input.title}.`,
          input.logline,
          input.characterHint ? `Lead: ${input.characterHint}` : "",
          MODEST_DRESS_RULE,
          "FaceTime-close on a strikingly beautiful lead. Faces large. One striking moment. No logos, no title cards, no captions.",
          "Fictional adults. Do not copy a public figure.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
  };
}
