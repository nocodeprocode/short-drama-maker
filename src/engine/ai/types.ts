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
import type { WrittenDocument } from "../pipeline/prop-bible.ts";

export type StoryAnalysisInput = {
  title: string;
  idea: string;
  /**
   * Roles the buyer cast before the story was written. The bible must use these
   * names verbatim so their chosen faces land on the parts they paid for.
   */
  required_cast?: ReadonlyArray<{
    name: string;
    note?: string;
    job?: "engine" | "wall" | "witness" | "nuke";
    importance?: "lead" | "supporting" | "background";
  }>;
  /**
   * Rooms the buyer approved on the design screen. Their plates are already
   * keyed by these names, so the bible has to reuse the names for the shoot to
   * find the plate instead of generating a second version of the same room.
   */
  required_locations?: ReadonlyArray<string>;
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
  /**
   * Splits a screenplay the buyer uploaded into exactly `episodeCount` ordered
   * episodes, keeping their scenes and dialogue instead of inventing new ones.
   */
  segmentScript?(input: {
    bible: StoryBible;
    script: string;
    episodeCount: number;
  }): Promise<StoryBible["episode_structure"]>;
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
  /**
   * Copywriter pass over the scene-take scripts: every cue on the nose, one
   * sentence, under 12 words, plain translatable English, names and numbers.
   * Keeps speakers, order, beats in parentheses, entrances and exits.
   */
  polishSceneDialogue?(input: {
    bible: StoryBible;
    takes: Array<{ index: number; scene_script: string; staging?: string | null }>;
  }): Promise<Array<{ index: number; scene_script: string }>>;
  /**
   * Real English for a contract / NDA / letter still. The image model typesets
   * these exact words so the paper is not dummy lettering.
   */
  writeDocument?(input: {
    name: string;
    title?: string;
    logline?: string;
    parties: string[];
  }): Promise<WrittenDocument>;
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
    /** Authoritative overhead room layout used with the master plate for new set angles. */
    layout_bytes?: Uint8Array;
    layout_mime_type?: string;
    /** Approved front still that locks lighting, backdrop, styling, and grading across an actor pack. */
    style_bytes?: Uint8Array;
    style_mime_type?: string;
    retry_attempt?: number;
    /** What the gate rejected last time, so the retry corrects that instead of guessing. */
    retry_note?: string;
    replaceWardrobe?: string;
    mode?: "likeness" | "generated";
  }): Promise<{ bytes: Uint8Array; mime_type: string }>;
  /**
   * Composites a character into a locked room so consecutive takes in a scene
   * start from the same pixels. `face_bytes` is reference 1 (identity wins),
   * `plate_bytes` is reference 2 (geography and light).
   */
  generateBlockingStill?(input: {
    characterName: string;
    description: string;
    framing: string;
    locationNote?: string | null;
    face_bytes: Uint8Array;
    face_mime_type: string;
    plate_bytes: Uint8Array;
    plate_mime_type: string;
  }): Promise<{ bytes: Uint8Array; mime_type: string }>;
  /** Fallback when two-ref compositing fails the room lock: plate is the only seed. */
  generateBlockingStillFromPlate?(input: {
    characterName: string;
    description: string;
    framing: string;
    locationNote?: string | null;
    plate_bytes: Uint8Array;
    plate_mime_type: string;
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
  video_reference_url?: string | null;
  audio_reference_url: string | null;
  duration_seconds: number;
  model: string;
  privacy_profile: PrivacyProfile;
  /** Null when no webhook endpoint is configured; the runner polls instead. */
  callback_url: string | null;
  /** Stable per-cast seed. Seedance may honor it; it is not a character ID. */
  seed?: number;
};

export interface AIRouter {
  selectVideoRoute(
    shot: Shot,
    privacy: PrivacyProfile,
    quality: QualityProfile,
    videoTier?: import("../domain.ts").VideoTier,
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
