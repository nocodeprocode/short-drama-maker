import type { AlignmentTrack } from "../domain.ts";
import { CAPTION_STYLE, prefixSpeakerCaption, speakerCaptionColor } from "../../drama-engine/types/audio.ts";

export type CaptionCue = {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  color?: string;
};

const PHRASE_WORDS_MIN = CAPTION_STYLE.wordsMin;
const PHRASE_WORDS_MAX = CAPTION_STYLE.wordsMax;
const PHRASE_CHARS = CAPTION_STYLE.maxCharsPerLine;

/** Measure-free wrap so a 720px plate never clips left/right. */
export function wrapCaptionLines(text: string, maxChars = CAPTION_STYLE.maxCharsPerLine): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    const trial = [...current, word].join(" ");
    const overChars = trial.length > maxChars && current.length >= 2;
    const overWords = current.length >= PHRASE_WORDS_MAX;
    if (current.length && (overChars || overWords)) {
      lines.push(current.join(" "));
      current = [word];
      if (lines.length >= CAPTION_STYLE.maxLines) break;
    } else {
      current.push(word);
    }
  }
  if (current.length && lines.length < CAPTION_STYLE.maxLines) lines.push(current.join(" "));
  return lines.slice(0, CAPTION_STYLE.maxLines);
}

export function captionsFromAlignment(track: AlignmentTrack): CaptionCue[] {
  const words = track.words.filter((word) => word.word.trim());
  if (words.length === 0) return [];
  const cues: CaptionCue[] = [];
  let chunk: typeof words = [];
  const flush = () => {
    if (!chunk.length) return;
    const text = wrapCaptionLines(chunk.map((item) => item.word).join(" ").replace(/\s+/g, " ").trim()).join("\n");
    cues.push({
      start: chunk[0]!.start,
      end: chunk[chunk.length - 1]!.end,
      text,
    });
    chunk = [];
  };
  for (const word of words) {
    const next = [...chunk, word];
    const text = next.map((item) => item.word).join(" ");
    const overWords = next.length > PHRASE_WORDS_MAX;
    const overChars = text.length > PHRASE_CHARS && next.length >= PHRASE_WORDS_MIN;
    if (chunk.length >= PHRASE_WORDS_MIN && (overWords || overChars)) {
      flush();
    }
    chunk.push(word);
  }
  flush();
  return mergeShortCaptionTails(cues);
}

function mergeShortCaptionTails(cues: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    const prev = out.at(-1);
    if (prev && words.length < PHRASE_WORDS_MIN) {
      const combined = `${prev.text.replace(/\n/g, " ")} ${cue.text.replace(/\n/g, " ")}`.replace(/\s+/g, " ").trim();
      const count = combined.split(/\s+/).filter(Boolean).length;
      if (count <= PHRASE_WORDS_MAX + 2 && combined.length <= PHRASE_CHARS + 12) {
        prev.text = wrapCaptionLines(combined).join("\n");
        prev.end = cue.end;
        continue;
      }
    }
    out.push({ ...cue });
  }
  return out;
}

export function offsetCues(cues: readonly CaptionCue[], offsetSeconds: number): CaptionCue[] {
  if (offsetSeconds === 0) return [...cues];
  return cues.map((cue) => ({
    ...cue,
    start: cue.start + offsetSeconds,
    end: cue.end + offsetSeconds,
  }));
}

export function captionsAlongTimeline(input: {
  shotDurations: number[];
  alignments: Array<AlignmentTrack | null | undefined>;
  pictureStarts?: Array<number | null | undefined>;
  speakers?: Array<string | null | undefined>;
}): CaptionCue[] {
  let t = 0;
  const cues: CaptionCue[] = [];
  for (let i = 0; i < input.shotDurations.length; i++) {
    const start = input.pictureStarts?.[i];
    const offset = typeof start === "number" ? start : t;
    const track = input.alignments[i];
    const speaker = input.speakers?.[i] ?? null;
    if (track) {
      const named = offsetCues(captionsFromAlignment(track), offset).map((cue) => ({
        ...cue,
        speaker,
        color: speakerCaptionColor(speaker),
        text: prefixSpeakerCaption(speaker, cue.text),
      }));
      cues.push(...named);
    }
    t += input.shotDurations[i] ?? 0;
  }
  return cues;
}

export function cuesToVtt(cues: readonly CaptionCue[]): string {
  const body = cues
    .map((cue, index) => {
      return `${index + 1}\n${formatTs(cue.start)} --> ${formatTs(cue.end)}\n${wrapCaptionLines(cue.text.replace(/\n/g, " ")).join("\n")}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function cuesFromVtt(vtt: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = vtt.split(/\n\s*\n/);
  for (const block of blocks) {
    const match = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s*\n([\s\S]+)/.exec(block);
    if (!match) continue;
    cues.push({
      start: parseVttTs(match[1]!),
      end: parseVttTs(match[2]!),
      text: match[3]!.replace(/\n+/g, " ").trim(),
    });
  }
  return cues;
}

export function cuesToAss(
  cues: readonly CaptionCue[],
  width = 720,
  height = 1280,
): string {
  const bandPct = (CAPTION_STYLE.bandFromTopPct.min + CAPTION_STYLE.bandFromTopPct.max) / 2;
  const marginV = Math.round(height * (1 - bandPct / 100));
  const events = cues.map((cue) => {
    const text = cue.text.replace(/\\/g, "\\\\").replace(/\n/g, "\\N");
    return `Dialogue: 0,${assTs(cue.start)},${assTs(cue.end)},Default,,0,0,0,,${text}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,36,36,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

function parseVttTs(stamp: string): number {
  const [h, m, rest] = stamp.split(":");
  const [s, ms] = (rest ?? "0.0").split(".");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function assTs(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  const frac = cs % 100;
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 2)}`;
}

function formatTs(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(frac, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
