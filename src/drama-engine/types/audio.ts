export type MixLane = "picture" | "dialogue_tts" | "dialogue_native" | "bed" | "stinger" | "sfx" | "captions";

export type HeardLane = "native" | "tts" | "silent";

export type MusicCueKind = "bed" | "sting" | "sfx";

export type MusicLibraryEntry = {
  id: string;
  kind: MusicCueKind;
  mood: string;
  file: string;
  duck_on_dialogue: boolean;
};

/** Never synthesize a sine/ping bed. Product mix loads these files or stays silent. */
export const MUSIC_LIBRARY: readonly MusicLibraryEntry[] = [
  { id: "bed-thriller", kind: "bed", mood: "thriller", file: "assets/music/beds/thriller-friction.mp3", duck_on_dialogue: true },
  { id: "bed-romance", kind: "bed", mood: "romance", file: "assets/music/beds/romance-under.mp3", duck_on_dialogue: true },
  { id: "bed-estate", kind: "bed", mood: "estate", file: "assets/music/beds/estate-night.mp3", duck_on_dialogue: true },
  { id: "bed-sting-tension", kind: "bed", mood: "tension", file: "assets/music/beds/tension-pad.mp3", duck_on_dialogue: true },
  { id: "sting-impact", kind: "sting", mood: "impact", file: "assets/music/stings/impact.mp3", duck_on_dialogue: false },
  { id: "sting-comic", kind: "sting", mood: "comic", file: "assets/music/stings/comic-didnt-know.mp3", duck_on_dialogue: false },
  { id: "sting-stunned", kind: "sting", mood: "stunned", file: "assets/music/stings/stunned.mp3", duck_on_dialogue: false },
  { id: "sfx-slap", kind: "sfx", mood: "slap", file: "assets/music/sfx/slap.mp3", duck_on_dialogue: false },
  { id: "sfx-door", kind: "sfx", mood: "door", file: "assets/music/sfx/door.mp3", duck_on_dialogue: false },
  { id: "sfx-glass", kind: "sfx", mood: "glass", file: "assets/music/sfx/glass.mp3", duck_on_dialogue: false },
  { id: "sfx-paper", kind: "sfx", mood: "paper", file: "assets/music/sfx/paper.mp3", duck_on_dialogue: false },
];

export type OverlapRule = {
  interruptLeadMs: { min: 200; max: 400 };
  lcutHoldMs: { min: 200; max: 400 };
};

export const OVERLAP: OverlapRule = {
  interruptLeadMs: { min: 200, max: 400 },
  lcutHoldMs: { min: 200, max: 400 },
};

export const LOUDNESS = {
  mixLufs: -14,
  truePeakDb: -1,
  dialogueShortTerm: { min: -14, max: -12 },
  musicUnderDialogueLufs: { min: -20, max: -18 },
  duckDb: { min: -10, max: -6 },
} as const;

export const CAPTION_STYLE = {
  wordsMin: 4,
  wordsMax: 8,
  maxCharsPerLine: 32,
  maxLines: 2,
  /** Lower-third title-safe. Chest-center (~50%) and TikTok chrome (bottom ~15%) are both illegal. */
  bandFromTopPct: { min: 70, max: 82 },
  keepOutBottomPx: 200,
  keepOutRightPx: 48,
  keepOutLeftPx: 48,
  canvas: { width: 720, height: 1280 },
  speakerColors: {
    mara: "#F4C36A",
    eli: "#8EC8FF",
    jules: "#C5B4F0",
  },
} as const;

export function speakerCaptionColor(name?: string | null): string {
  const key = (name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (key.startsWith("mara")) return CAPTION_STYLE.speakerColors.mara;
  if (key.startsWith("eli")) return CAPTION_STYLE.speakerColors.eli;
  if (key.startsWith("jules")) return CAPTION_STYLE.speakerColors.jules;
  return "#FFFFFF";
}

export function speakerCaptionTag(name?: string | null): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  if (!first) return null;
  return first.replace(/[^A-Za-z]/g, "").toUpperCase() || null;
}

export function prefixSpeakerCaption(name: string | null | undefined, text: string): string {
  const tag = speakerCaptionTag(name);
  const cleaned = text.replace(/^\s*[A-Z]{2,12}:\s*/, "").trim();
  if (!tag) return cleaned;
  if (cleaned.toUpperCase().startsWith(`${tag}:`)) return cleaned;
  return `${tag}: ${cleaned}`;
}
