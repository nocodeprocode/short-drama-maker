import {
  DIALOGUE_TTS_PRICE,
  IMAGE_PRICE,
  LLM_PRICE,
  MODEL_PRICES_PER_SECOND,
  VISION_PRICE,
  VOICE_DESIGN_PRICE,
} from "../config/models.ts";
import type { PricingEngine } from "./types.ts";

export const pricing: PricingEngine = {
  estimateVideo(model, durationSeconds) {
    const perSecond = MODEL_PRICES_PER_SECOND[model];
    if (perSecond === undefined) {
      throw new Error(`No price snapshot for model ${model}`);
    }
    return roundMoney(perSecond * durationSeconds);
  },
  estimateDialogue() {
    return DIALOGUE_TTS_PRICE;
  },
  estimateImage() {
    return IMAGE_PRICE;
  },
  estimateLlm() {
    return LLM_PRICE;
  },
  estimateVoiceDesign() {
    return VOICE_DESIGN_PRICE;
  },
  estimateVision() {
    return VISION_PRICE;
  },
};

export function roundMoney(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
