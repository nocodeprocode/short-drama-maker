export type QualityProfile = "auto" | "economy" | "maximum";
export type PrivacyProfile = "standard";
export type NarrationMode = "off" | "on";

export type SeriesStatus = "draft" | "ready" | "producing" | "complete";
export type EpisodeStatus = "draft" | "planned" | "producing" | "needs_review" | "complete";
export type SceneStatus = "draft" | "planned" | "producing" | "complete";
export type ShotStatus = "planned" | "audio_ready" | "generating" | "complete" | "needs_review";
export type CharacterLockState = boolean;

export type ShotType =
  | "dialogue"
  | "reaction"
  | "establishing"
  | "broll"
  | "hero";

export type JobType =
  | "story_analysis"
  | "voice_design"
  | "image"
  | "dialogue_tts"
  | "video"
  | "ingest"
  | "qc"
  | "render"
  | "gc"
  | "reconcile"
  | "cut_detect"
  | "mix"
  | "music"
  | "drama_lint";

export type JobStatus =
  | "queued"
  | "submitting"
  | "generating"
  | "ingesting"
  | "qc"
  | "completed"
  | "needs_review"
  | "failed"
  | "cancelled";

export type LedgerEntryType =
  | "purchase"
  | "reserve"
  | "settle"
  | "release"
  | "adjustment";

export type AssetKind =
  | "script"
  | "character_image"
  | "character_reference"
  | "voice_reference"
  | "voice_preview"
  | "series_cover"
  | "dialogue_audio"
  | "dialogue_alignment"
  | "shot_video"
  | "episode_final"
  | "episode_block"
  | "episode_audit"
  | "episode_captions"
  | "episode_provenance"
  | "music"
  | "sfx";

export type AssetBucket =
  | "private-source"
  | "private-character"
  | "private-generation"
  | "private-final";

export type ModerationCheckpoint =
  | "story_input"
  | "character_create"
  | "shot_submit"
  /** A spoken line on its way to TTS: adults talking, not a pictured subject. */
  | "dialogue";

export type ModerationCategory =
  | "ok"
  | "real_person_likeness"
  | "minor"
  | "sexual"
  | "other";

export type ScreenplayRules = {
  narration_mode: NarrationMode;
  dialogue_first: true;
  require_conflict_or_progression: true;
  require_reactions: true;
  require_episode_hook: true;
  require_cliffhanger: true;
  target_episode_seconds: number;
  min_shots: number;
  max_shots: number;
  min_shot_s: number;
  max_shot_s: number;
  max_dialogue_s: number;
};

export const SCREENPLAY_RULES: ScreenplayRules = {
  narration_mode: "off",
  dialogue_first: true,
  require_conflict_or_progression: true,
  require_reactions: true,
  require_episode_hook: true,
  require_cliffhanger: true,
  target_episode_seconds: 60,
  min_shots: 8,
  max_shots: 12,
  min_shot_s: 4,
  max_shot_s: 8,
  max_dialogue_s: 10,
};

export type AppearanceProfile = {
  age_look: string;
  ethnicity_notes: string;
  hair: string;
  face: string;
  body: string;
  default_wardrobe: string;
};

export type PendingVoicePreview = {
  preview_id: string;
  elevenlabs_voice_id: string;
  preview_label: string;
  asset_id: string;
  mime_type: string;
};

export type VoiceProfile = {
  design_prompt: string;
  elevenlabs_voice_id: string | null;
  canonical_reference_asset_id: string | null;
  accent: string;
  age_profile: string;
  speaking_style: string;
  default_energy: string;
  voice_version: number;
  locked: boolean;
  pending_previews?: PendingVoicePreview[];
};

export type VisualReferenceKind =
  | "cu"
  | "front"
  | "three_quarter"
  | "profile"
  | "full_body"
  | "default_wardrobe";

export type ActorSource = "generated" | "likeness";

export type Actor = {
  id: string;
  owner_id: string;
  name: string;
  source: ActorSource;
  seed_asset_id: string | null;
  appearance_profile: AppearanceProfile;
  visual_reference_asset_ids: Partial<Record<VisualReferenceKind, string>>;
  created_at: string;
  updated_at: string;
};

export type Character = {
  id: string;
  series_id: string;
  name: string;
  description: string;
  actor_id: string | null;
  appearance_profile: AppearanceProfile;
  visual_reference_asset_ids: Partial<Record<VisualReferenceKind, string>>;
  wardrobe_asset_ids: Record<string, string>;
  voice_profile: VoiceProfile;
  personality_profile: Record<string, unknown>;
  relationships: Record<string, string>;
  default_wardrobe: string;
  locked: CharacterLockState;
  created_at: string;
  updated_at: string;
};

export type SeasonSku = 2 | 12 | 24 | 45 | 60;

export type Series = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  style_profile: Record<string, unknown>;
  story_bible: StoryBible | null;
  target_episode_count: SeasonSku | null;
  sku: string | null;
  location_refs: Record<string, string>;
  cover_asset_id: string | null;
  status: SeriesStatus;
  deleted_at: string | null;
  created_at: string;
};

export type ShotEditMode = "locked_take" | "already_cut" | "coverage_single";
export type ShotAudioRole = "onscreen" | "offscreen" | "two_shot_avoid" | "silent";
export type ShotEyeline = "left_of_camera" | "right_of_camera" | "down" | "lens_forbidden";
export type ShotFunction =
  | "hook_cu"
  | "accusation_cu"
  | "listener_hold"
  | "insert_evidence"
  | "doorway_reveal"
  | "slap_peak"
  | "reaction"
  | "phone_ui"
  | "stacked_two"
  | "establishing"
  | "button_cu"
  | "block_button"
  | "name_plant";
export type ShotContinuity = {
  kind: "weld" | "jump";
  prev_shot_id?: string;
  last_frame_asset_id?: string;
};
export type SilenceLicense = "post_slap" | "post_nuke" | "button_freeze" | "illegal_opera";

export type ShotData = {
  type: ShotType;
  speaker: string | null;
  dialogue: string | null;
  emotion: string | null;
  delivery: string | null;
  pace: string | null;
  camera: string;
  mouth_visibility_required: boolean;
  duration_hint_seconds: number;
  duration_seconds: number | null;
  dialogue_audio_asset_id: string | null;
  dialogue_alignment_asset_id: string | null;
  hero: boolean;
  edit_mode?: ShotEditMode;
  audio_role?: ShotAudioRole;
  speaker_on_camera?: string | null;
  speakers_off_camera?: string[];
  eyeline?: ShotEyeline;
  continuity?: ShotContinuity;
  function?: ShotFunction;
  internal_cut_count?: number | null;
  look_id?: string | null;
  insert_plate_id?: string | null;
  silence_license?: SilenceLicense | null;
  needs_reaction_pad?: boolean;
  recap?: boolean;
  block_index?: number;
  heard_audio?: "native" | "tts" | "silent";
  camera_move?: string | null;
  comic_sting?: boolean;
  sfx?: string | null;
  first_frame_asset_id?: string | null;
  identity_reject?: boolean;
  group_still_asset_id?: string | null;
  /** Measured at ingest for the selected take; drives settle trim, pad, and QC. */
  take_analysis?: import("./pipeline/take-analysis.ts").TakeAnalysis | null;
  /** Reference still used for the modesty gate (per character, modest wardrobe). */
  modest_still_asset_id?: string | null;
  /** When the line was last rewritten; video attempts before this do not count against the retry cap. */
  line_revised_at?: string | null;
  /** Number of rewrites; part of the TTS job key so a new line gets new speech. */
  line_revision?: number;
  /** Reviewer decisions per take; an approval overrides ranking, a rejection excludes the take. */
  take_reviews?: Array<{ asset_id: string; decision: "approve" | "reject"; note: string | null; reviewed_at: string; reviewer_id: string }>;
};

export type Shot = {
  id: string;
  scene_id: string;
  position: number;
  shot_data: ShotData;
  selected_generation_id: string | null;
  status: ShotStatus;
};

export type SceneData = {
  location: string;
  time: string;
  characters: string[];
  kind?: "recap" | "dialogue" | "evidence" | "button";
  block_index?: number;
};

export type Scene = {
  id: string;
  episode_id: string;
  position: number;
  location: string;
  scene_data: SceneData;
  status: SceneStatus;
};

export type RenderTransitionType = "cut" | "jcut" | "lcut" | "hold";

export type RenderManifestShot = {
  shot_id: string;
  asset_id: string;
  in_point_seconds: number;
  out_point_seconds: number;
  overlap_seconds?: number;
  audio_role?: ShotAudioRole;
  picture_start_seconds?: number;
  audio_start_seconds?: number | null;
  hold_tail_seconds?: number;
  /**
   * Native audio starts this many seconds earlier relative to picture (a slip
   * edit) to pull a mouth that opened before the voice back into sync. Picture
   * loses the same seconds off its tail.
   */
  audio_slip_seconds?: number;
  scene_index?: number;
  scene_kind?: "recap" | "dialogue" | "evidence" | "button";
  transition_in?: RenderTransitionType;
  spike?: boolean;
  block_index?: number;
  sting?: boolean;
  heard_audio?: "native" | "tts" | "silent";
  music_mood?: string | null;
  sfx?: string | null;
  speaker?: string | null;
};

export type RenderManifest = {
  version: 1;
  episode_id: string;
  shots: RenderManifestShot[];
  caption_asset_ids: string[];
  music_asset_ids: string[];
  sfx_asset_ids: string[];
  transitions: Array<{ after_shot_id: string; type: RenderTransitionType; overlap_seconds?: number }>;
  scenes?: Array<{ index: number; kind: string; shot_ids: string[] }>;
};

export type Episode = {
  id: string;
  series_id: string;
  episode_number: number;
  title: string;
  script: string;
  status: EpisodeStatus;
  render_manifest: RenderManifest | null;
  episode_outline?: import("../drama-engine/plans/long-form.ts").EpisodeOutline | null;
  /** Increments on every accepted render; each final asset keeps its version in metadata. */
  render_version?: number;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  owner_id: string;
  series_id: string | null;
  actor_id?: string | null;
  kind: AssetKind;
  bucket: AssetBucket;
  storage_path: string;
  mime_type: string;
  bytes: number;
  checksum: string;
  metadata: Record<string, unknown>;
  created_at: string;
  deleted_at: string | null;
};

export type GenerationJob = {
  id: string;
  owner_id: string;
  series_id: string;
  episode_id: string | null;
  scene_id: string | null;
  shot_id: string | null;
  job_type: JobType;
  model: string | null;
  provider: string | null;
  upstream_job_id: string | null;
  callback_token: string;
  callback_token_used: boolean;
  idempotency_key: string;
  status: JobStatus;
  request_metadata: Record<string, unknown>;
  result_metadata: Record<string, unknown>;
  estimated_cost: number;
  actual_cost: number | null;
  attempt: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  expected_ready_at: string;
};

export type LedgerEntry = {
  id: string;
  owner_id: string;
  series_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  generation_job_id: string | null;
  stripe_event_id: string | null;
  price_snapshot_version: string;
  created_at: string;
};

export type ModerationDecision = {
  id: string;
  job_id: string | null;
  series_id: string | null;
  checkpoint: ModerationCheckpoint;
  verdict: "allow" | "block";
  category: ModerationCategory;
  reason: string;
  created_at: string;
};

export type StoryBible = {
  title: string;
  logline: string;
  characters: Array<{
    name: string;
    description: string;
    appearance: AppearanceProfile;
    personality: Record<string, unknown>;
    relationships: Record<string, string>;
    voice_design_prompt: string;
  }>;
  locations: string[];
  episode_structure: Array<{
    episode_number: number;
    title: string;
    hook: string;
    conflict: string;
    type?: "HookEp" | "RevealEp" | "ConfrontationEp" | "CliffhangerEp" | "ComfortEp" | "TentpoleEp";
    cliffhanger?: string;
    tentpole?: boolean;
    paywall_flag?: boolean;
  }>;
  visual_style: Record<string, unknown>;
  rules: ScreenplayRules;
};

export type EpisodePlan = {
  title: string;
  hook: string;
  conflict: string;
  cliffhanger: string;
  outline?: import("../drama-engine/plans/long-form.ts").EpisodeOutline;
  scenes: ShotPlanScene[];
};

export type ShotPlanScene = {
  location: string;
  time: string;
  characters: string[];
  kind?: "recap" | "dialogue" | "evidence" | "button";
  block_index?: number;
  shots: Array<{
    type: ShotType;
    speaker: string | null;
    dialogue: string | null;
    emotion: string | null;
    delivery: string | null;
    pace: string | null;
    camera: string;
    mouth_visibility_required: boolean;
    duration_hint_seconds: number;
    hero?: boolean;
    edit_mode?: ShotEditMode;
    audio_role?: ShotAudioRole;
    speaker_on_camera?: string | null;
    speakers_off_camera?: string[];
    eyeline?: ShotEyeline;
    function?: ShotFunction;
    silence_license?: SilenceLicense | null;
    recap?: boolean;
    block_index?: number;
    camera_move?: string | null;
    comic_sting?: boolean;
    sfx?: string | null;
    /** Index of the planned scene this shot came from; repair uses it to keep location/time when regrouping. */
    origin_scene?: number;
  }>;
};

export type VoiceCandidate = {
  preview_id: string;
  elevenlabs_voice_id: string;
  preview_label: string;
  preview_audio_bytes: Uint8Array;
  preview_mime_type: string;
};

export type VoiceIdentity = {
  elevenlabs_voice_id: string;
  canonical_reference_asset_id: string;
  voice_version: number;
};

export type AudioAssetWithAlignment = {
  audio: {
    bytes: Uint8Array;
    mime_type: string;
    duration_seconds: number;
  };
  alignment: {
    json: AlignmentTrack;
    mime_type: "application/json";
  };
};

export type AlignmentWord = {
  word: string;
  start: number;
  end: number;
};

export type AlignmentChar = {
  char: string;
  start: number;
  end: number;
};

export type AlignmentTrack = {
  text: string;
  characters: AlignmentChar[];
  words: AlignmentWord[];
};

export type VideoRoute = {
  model: string;
  provider: string;
  role:
    | "dialogue_default"
    | "economy_default"
    | "visual_default"
    | "hero"
    | "privacy_fallback"
    | "action";
  min_duration_seconds: number;
  max_duration_seconds: number;
  aspect_ratios: ["9:16", ...string[]];
  audio_conditioning_verified: boolean;
  region_documented: boolean;
  strict_privacy_allowed: boolean;
};

export type RouteDecision = {
  route: VideoRoute;
  reason: string;
};

export type ModerationVerdict = {
  verdict: "allow" | "block";
  category: ModerationCategory;
  reason: string;
};

export type GenerationStatus = {
  upstream_job_id: string;
  status: "pending" | "completed" | "failed" | "cancelled" | "expired";
  output_url: string | null;
  actual_cost: number | null;
  error: string | null;
};

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "needs_review",
  "failed",
  "cancelled",
]);

export const ACTIVE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([
  "queued",
  "submitting",
  "generating",
]);
