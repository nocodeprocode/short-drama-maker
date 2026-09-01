import { IMAGE_MODEL, IMAGE_PRICE } from "../config/models.ts";
import type { ImageEngine } from "./types.ts";
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

async function requestImage(
  prompt: string,
  seed?: { bytes: Uint8Array; mime_type: string },
): Promise<{ bytes: Uint8Array; mime_type: string }> {
  const body = await openRouterJson<ImageResponse>("/images", {
    method: "POST",
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      aspect_ratio: "9:16",
      output_format: "png",
      provider: openRouterProvider(),
      ...(seed
        ? {
            input_references: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${seed.mime_type};base64,${Buffer.from(seed.bytes).toString("base64")}`,
                },
              },
            ],
          }
        : {}),
    }),
  }, { idempotent: true });
  costMeter.record(openRouterUsageCost(body.usage, IMAGE_PRICE, "image"));
  const image = body.data?.[0];
  if (image?.b64_json) {
    return {
      bytes: decodeBase64(image.b64_json),
      mime_type: image.media_type ?? "image/png",
    };
  }
  if (image?.url) {
    assertSafeImageUrl(image.url);
    const response = await providerFetch(image.url, {}, { provider: "openrouter-cdn", timeoutMs: 60_000 });
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mime_type: response.headers.get("content-type") ?? "image/png",
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
      const tight = input.kind === "cu" || input.kind === "front" || input.kind === "three_quarter" || input.kind === "profile";
      return requestImage(
        [
          tight
            ? "Photorealistic vertical 9:16 HEAD-AND-SHOULDERS close-up. Face fills the frame. Cropped at the chest. NOT a full-body standing pose. NOT a wide master."
            : "Photorealistic vertical 9:16 character reference still.",
          `Character: ${input.characterName}.`,
          input.description,
          `Pose / framing: ${input.kind}.`,
          MODEST_DRESS_RULE,
          "Fictional adult. No celebrity likeness. Neutral set lighting. Single subject. ONE person only. Same wardrobe as described.",
          "Ignore any sleepwear, bare-leg, or underdressed wardrobe in the character notes. Dress them modestly instead.",
        ].join(" "),
      );
    },
    async generateReferenceFromSeed(input) {
      const tight = input.kind === "cu" || input.kind === "front" || input.kind === "three_quarter";
      return requestImage(
        [
          tight
            ? "Same person as the reference photo. Tight vertical 9:16 HEAD-AND-SHOULDERS close-up. Face fills the frame. Cropped at the chest. NOT full body. NOT a second person."
            : "Photorealistic vertical 9:16 character reference still.",
          input.replaceWardrobe
            ? `Same face, hair, age, and identifying marks as the reference. REPLACE the clothing. New wardrobe only: ${input.replaceWardrobe}. Do not copy sheer, thin, or see-through fabric. No undergarment line.`
            : "Keep the same face, hair, age, and wardrobe as the reference photo. No costume change.",
          `Character: ${input.characterName}.`,
          input.description,
          `Pose / framing: ${input.kind}.`,
          MODEST_DRESS_RULE,
          "Adult only. No celebrity likeness. Neutral set lighting. Single subject.",
          "Ignore any sleepwear, bare-leg, or underdressed wardrobe in the notes. Dress them modestly instead.",
        ].join(" "),
        { bytes: input.seed_bytes, mime_type: input.seed_mime_type },
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
          "Cinematic lighting. One striking moment. No logos, no title cards, no captions.",
          "Fictional adults. No celebrity likeness.",
        ]
          .filter(Boolean)
          .join(" "),
      );
    },
  };
}
