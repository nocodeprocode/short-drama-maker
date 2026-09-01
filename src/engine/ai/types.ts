import type {
  AlignmentTrack,
  AudioAssetWithAlignment,
  EpisodePlan,
  GenerationJob,
  GenerationStatus,
  ModerationCheckpoint,
  ModerationVerdict,
  PrivacyProfile,
  QualityProfile,
  Shot,
  StoryBible,
  VoiceCandidate,
  VoiceIdentity,
} from "../domain.ts";

export type StoryAnalysisInput = {
  title: string;
  idea: string;
};

export type DialogueLine = {
  speaker: string;
  text: string;
  emotion: string | null;
  delivery: string | null;
  pace: string | null;
  scene_id: string;
};

export interface LLMEngine {
  analyzeStory(input: StoryAnalysisInput): Promise<StoryBible>;
  writeEpisode(input: {
    bible: StoryBible;
    episodeNumber: number;
    episode_length?: import("../config/catalog.ts").EpisodeLength;
  }): Promise<EpisodePlan>;
  planShots(input: {
    plan: EpisodePlan;
    bible?: StoryBible;
    episode_length?: import("../config/catalog.ts").EpisodeLength;
  }): Promise<EpisodePlan>;
  outlineEpisode?(input: {
    bible: StoryBible;
    episodeNumber: number;
    episode_length?: import("../config/catalog.ts").EpisodeLength;
  }): Promise<import("../../drama-engine/plans/long-form.ts").EpisodeOutline>;
  writeEpisodeBlocks?(input: {
    bible: StoryBible;
    outline: import("../../drama-engine/plans/long-form.ts").EpisodeOutline;
    blocks: import("../../drama-engine/plans/long-form.ts").EpisodeOutlineBlock[];
    episode_length?: import("../config/catalog.ts").EpisodeLength;
  }): Promise<import("../domain.ts").ShotPlanScene[]>;
}

export interface VoiceEngine {
  designVoice(description: string): Promise<VoiceCandidate[]>;
  saveVoice(
    candidate: VoiceCandidate,
    options?: { name?: string; description?: string },
  ): Promise<VoiceIdentity>;
  synthesize(
    voiceIdentity: VoiceIdentity,
    dialogue: DialogueLine,
  ): Promise<AudioAssetWithAlignment>;
}

export interface ImageEngine {
  generateReference(input: {
    characterName: string;
    description: string;
    kind: string;
  }): Promise<{ bytes: Uint8Array; mime_type: string }>;
  generateReferenceFromSeed(input: {
    characterName: string;
    description: string;
    kind: string;
    seed_bytes: Uint8Array;
    seed_mime_type: string;
    replaceWardrobe?: string;
  }): Promise<{ bytes: Uint8Array; mime_type: string }>;
  generateCover?(input: {
    title: string;
    logline: string;
    characterHint?: string;
  }): Promise<{ bytes: Uint8Array; mime_type: string }>;
}

export interface VideoEngine {
  submit(request: VideoSubmitRequest): Promise<{
    upstream_job_id: string;
    provider: string;
    model: string;
  }>;
  getStatus(job: Pick<GenerationJob, "upstream_job_id" | "provider" | "model">): Promise<GenerationStatus>;
  download(job: Pick<GenerationJob, "upstream_job_id" | "provider" | "model">): Promise<{
    bytes: Uint8Array;
    mime_type: string;
  }>;
}

export type VideoSubmitRequest = {
  shot: Shot;
  prompt: string;
  visual_reference_urls: string[];
  audio_reference_url: string | null;
  duration_seconds: number;
  model: string;
  privacy_profile: PrivacyProfile;
  /** Null when no webhook endpoint is configured; the runner polls instead. */
  callback_url: string | null;
};

export interface AIRouter {
  selectVideoRoute(
    shot: Shot,
    privacy: PrivacyProfile,
    quality: QualityProfile,
  ): import("../domain.ts").RouteDecision;
}

export interface ModerationEngine {
  check(
    content: string,
    checkpoint: ModerationCheckpoint,
  ): Promise<ModerationVerdict>;
}

export type PrivacySettings = {
  zdr: boolean;
  data_collection: "deny";
  allow_fallbacks: false;
  only?: string[];
};

export interface PricingEngine {
  estimateVideo(model: string, durationSeconds: number): number;
  estimateDialogue(): number;
  estimateImage(): number;
  estimateLlm(): number;
  estimateVoiceDesign(): number;
  estimateVision(): number;
}

export type AlignmentSource = AlignmentTrack;
