import type { AlignmentTrack } from "../domain.ts";
import { CAPTION_STYLE, prefixSpeakerCaption, speakerCaptionColor } from "../../drama-engine/types/audio.ts";
import { cueRows, cueText } from "../../drama-engine/types/continuity.ts";

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

/** One caption per script cue, labeled with that cue's speaker — not the take's first speaker. */
export function captionsFromSceneScript(
  script: string,
  durationSeconds: number,
  offsetSeconds = 0,
): CaptionCue[] {
  const rows = cueRows(script);
  if (!rows.length) return [];
  const weights = rows.map((row) => {
    const words = cueText(row)
      .replace(/\([^)]*\)/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, words);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const settle = Math.min(0.4, Math.max(0, durationSeconds) * 0.05);
  const speakable = Math.max(0.5, Math.max(0, durationSeconds) - settle - 0.12);
  let t = offsetSeconds + settle;
  return rows.map((row, index) => {
    const speaker = row.split(":")[0]?.trim() || null;
    const spoken = cueText(row)
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const span = (weights[index]! / total) * speakable;
    const start = t;
    const end = t + span;
    t = end;
    return {
      start,
      end,
      speaker,
      color: speakerCaptionColor(speaker),
      text: prefixSpeakerCaption(speaker, wrapCaptionLines(spoken).join("\n")),
    };
  });
}

function foldWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function spokenWordsOf(row: string): string[] {
  return cueText(row)
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map(foldWord)
    .filter(Boolean);
}

function matchCueToWords(
  want: readonly string[],
  words: AlignmentTrack["words"],
  from: number,
): { start: number; end: number; next: number } | null {
  if (!want.length || from >= words.length) return null;
  let start = -1;
  let matched = 0;
  for (let i = from; i < words.length; i += 1) {
    const w = foldWord(words[i]!.word);
    if (!w) continue;
    const target = want[matched] ?? "";
    if (target && (w === target || target.startsWith(w) || w.startsWith(target))) {
      if (matched === 0) start = i;
      matched += 1;
      if (matched >= want.length) return { start, end: i, next: i + 1 };
      continue;
    }
    if (matched > 0 && i - start > want.length + 2) {
      if (w === want[0] || want[0]?.startsWith(w) || w.startsWith(want[0] ?? "___")) {
        start = i;
        matched = 1;
      } else {
        start = -1;
        matched = 0;
      }
    }
  }
  if (matched > 0 && start >= 0) return { start, end: start + matched - 1, next: start + matched };
  return null;
}

/** Script text and speakers, timed to STT words when the mouths actually said them. */
export function captionsFromAlignedScript(
  script: string,
  track: AlignmentTrack,
  offsetSeconds = 0,
  fallbackDuration = 0,
): CaptionCue[] {
  const rows = cueRows(script);
  if (!rows.length) return [];
  const words = track.words.filter((word) => foldWord(word.word));
  if (!words.length) return captionsFromSceneScript(script, fallbackDuration, offsetSeconds);

  let cursor = 0;
  const spans = rows.map((row) => {
    const hit = matchCueToWords(spokenWordsOf(row), words, cursor);
    if (!hit) return null;
    cursor = hit.next;
    return { start: words[hit.start]!.start, end: words[hit.end]!.end };
  });
  if (!spans.some(Boolean)) {
    const span = Math.max(0.5, words.at(-1)!.end - words[0]!.start);
    return captionsFromSceneScript(script, span, offsetSeconds + words[0]!.start);
  }

  return rows.map((row, index) => {
    const speaker = row.split(":")[0]?.trim() || null;
    const spoken = cueText(row)
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hit = spans[index];
    const prev = [...spans.slice(0, index)].reverse().find(Boolean);
    const next = spans.slice(index + 1).find(Boolean);
    const start = hit?.start ?? prev?.end ?? words[0]!.start;
    const end = hit?.end ?? next?.start ?? Math.max(start + 0.35, words.at(-1)!.end);
    return {
      start: start + offsetSeconds,
      end: Math.max(start + 0.2, end) + offsetSeconds,
      speaker,
      color: speakerCaptionColor(speaker),
      text: prefixSpeakerCaption(speaker, wrapCaptionLines(spoken).join("\n")),
    };
  });
}

export function captionsAlongTimeline(input: {
  shotDurations: number[];
  alignments: Array<AlignmentTrack | null | undefined>;
  pictureStarts?: Array<number | null | undefined>;
  speakers?: Array<string | null | undefined>;
  scripts?: Array<string | null | undefined>;
}): CaptionCue[] {
  let t = 0;
  const cues: CaptionCue[] = [];
  for (let i = 0; i < input.shotDurations.length; i++) {
    const start = input.pictureStarts?.[i];
    const offset = typeof start === "number" ? start : t;
    const duration = input.shotDurations[i] ?? 0;
    const script = input.scripts?.[i]?.trim() ?? "";
    const track = input.alignments[i];
    if (script && cueRows(script).length && track?.words.length) {
      cues.push(...captionsFromAlignedScript(script, track, offset, duration));
    } else if (script && cueRows(script).length) {
      cues.push(...captionsFromSceneScript(script, duration, offset));
    } else if (track) {
      const speaker = input.speakers?.[i] ?? null;
      const named = offsetCues(captionsFromAlignment(track), offset).map((cue) => ({
        ...cue,
        speaker,
        color: speakerCaptionColor(speaker),
        text: prefixSpeakerCaption(speaker, cue.text),
      }));
      cues.push(...named);
    }
    t += duration;
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

/** SubRip sidecar for platforms that do not take WebVTT (broadcast QC, YouTube uploads). */
export function cuesToSrt(cues: readonly CaptionCue[]): string {
  const stamp = (seconds: number) => formatTs(seconds).replace(".", ",");
  return cues
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${wrapCaptionLines(cue.text.replace(/\n/g, " ")).join("\n")}\n`)
    .join("\n");
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
  width = 1080,
  height = 1920,
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
Style: Default,Arial,63,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,1,2,54,54,${marginV},1

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
