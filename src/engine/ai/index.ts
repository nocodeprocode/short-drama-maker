import { createElevenLabsVoice } from "./elevenlabs.ts";
import { createOpenRouterImages } from "./images.ts";
import { createOpenRouterLlm } from "./llm.ts";
import { createOpenRouterVideo } from "./video.ts";
import { createOpenRouterVision, type VisionEngine } from "./vision.ts";
import { transcribeAudio } from "./stt.ts";
import { costMeter, type CostMeter } from "./meter.ts";
import { moderation } from "./moderation.ts";
import { pricing } from "./pricing.ts";
import { router } from "./router.ts";
import * as privacy from "./privacy.ts";
import type { ImageEngine, LLMEngine, VideoEngine, VoiceEngine } from "./types.ts";

export type SttEngine = {
  transcribe(input: { bytes: Uint8Array; format: string }): Promise<{ text: string }>;
};

export type AIGateway = {
  llm: LLMEngine;
  image: ImageEngine;
  speech: VoiceEngine;
  video: VideoEngine;
  stt?: SttEngine;
  /** Identity judge for takes. Absent → the RGB fallback runs and face fields stay null. */
  vision?: VisionEngine;
  /** Real provider spend recorded by the modules above; drained per job at settle. */
  meter: CostMeter;
  router: typeof router;
  privacy: typeof privacy;
  moderation: typeof moderation;
  pricing: typeof pricing;
};

export function createAiGateway(
  overrides: Partial<Pick<AIGateway, "llm" | "image" | "speech" | "video" | "stt" | "vision">> = {},
): AIGateway {
  return {
    llm: overrides.llm ?? createOpenRouterLlm(),
    image: overrides.image ?? createOpenRouterImages(),
    speech: overrides.speech ?? createElevenLabsVoice(),
    video: overrides.video ?? createOpenRouterVideo(),
    stt: overrides.stt ?? { transcribe: transcribeAudio },
    vision: "vision" in overrides ? overrides.vision : createOpenRouterVision(),
    meter: costMeter,
    router,
    privacy,
    moderation,
    pricing,
  };
}

export { ContentBlockedError, moderation } from "./moderation.ts";
export { pricing } from "./pricing.ts";
export { router } from "./router.ts";
export { assertStandardOnly, privacySettings } from "./privacy.ts";
