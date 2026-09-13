import { cueRows, cueText } from "../types/continuity.ts";
import { humanMotifs, stripIrisPhrases, stripPowerLanguage } from "../types/where.ts";

/**
 * Applicable context for one Seedance take.
 * Not the whole bible — only what this clip must continue.
 */

export type VideoContextCharacter = {
  name: string;
  description?: string | null;
  appearance?: {
    ethnicity_notes?: string | null;
    hair?: string | null;
    face?: string | null;
    default_wardrobe?: string | null;
  } | null;
  relationships?: Record<string, string> | null;
};

export type VideoContextPriorTake = {
  scene_script?: string | null;
  blocking?: { present?: string[] | null; prop?: string | null; staging?: string | null } | null;
  blocking_note?: string | null;
};

export type VideoContextInput = {
  title?: string | null;
  logline?: string | null;
  visualStyle?: string | null;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  hook?: string | null;
  conflict?: string | null;
  cliffhanger?: string | null;
  genreMotifs?: readonly string[] | null;
  characters?: VideoContextCharacter[];
  priorTakes?: VideoContextPriorTake[];
  priorEpisode?: { number?: number | null; cliffhanger?: string | null; last_script?: string | null } | null;
  thisTake?: {
    index?: number | null;
    scene_script?: string | null;
    present?: string[] | null;
    prop?: string | null;
  };
};

function clip(text: string | null | undefined, words: number): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length <= words) return clean.replace(/[.]+$/, "");
  return parts.slice(0, words).join(" ");
}

export function lastSpokenLine(script?: string | null): string | null {
  const rows = cueRows(script);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const line = cueText(rows[i] ?? "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) return line;
  }
  return null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function samePerson(a: string, b: string): boolean {
  return firstName(a).toLowerCase() === firstName(b).toLowerCase();
}

function castLine(row: VideoContextCharacter, others: string[]): string | null {
  const name = row.name.trim();
  if (!name) return null;
  const look = [
    row.appearance?.ethnicity_notes,
    row.appearance?.hair,
    // Eye colour comes from the still, never from words — see stripIrisPhrases.
    stripIrisPhrases(stripPowerLanguage(row.appearance?.face)),
  ]
    .map((part) => clip(part, 6))
    .filter(Boolean)
    .join(", ");
  const wardrobe = clip(row.appearance?.default_wardrobe, 8);
  const relation = others
    .map((other) => {
      const hit = Object.entries(row.relationships ?? {}).find(([key]) => samePerson(key, other));
      return hit ? clip(hit[1], 8) : null;
    })
    .find(Boolean);
  const job = clip(row.description, 10);
  const bits = [look || job, wardrobe ? `wardrobe ${wardrobe}` : null, relation].filter(Boolean);
  if (!bits.length) return name;
  return `${name}: ${bits.join("; ")}`;
}

/**
 * One CONTEXT clause. Series + this episode + what already played + last clip.
 * The model should continue, not restart, and never say a finished line again.
 */
export function videoContextBlock(input: VideoContextInput): string | null {
  const present = (input.thisTake?.present ?? []).map((name) => name.trim()).filter(Boolean);
  const prior = input.priorTakes ?? [];
  const already = prior
    .map((take) => lastSpokenLine(take.scene_script))
    .filter((line): line is string => Boolean(line))
    .slice(-4);
  const lastTake = prior.at(-1);
  const lastLine = lastSpokenLine(lastTake?.scene_script);
  const lastNote = clip(lastTake?.blocking_note ?? lastTake?.blocking?.staging, 22);
  const prop = input.thisTake?.prop ?? lastTake?.blocking?.prop ?? null;
  const onCamera = present.length
    ? present
    : (input.characters ?? []).map((row) => row.name).filter(Boolean).slice(0, 3);
  const cast = (input.characters ?? [])
    .filter((row) => onCamera.some((name) => samePerson(name, row.name)))
    .map((row) => castLine(row, onCamera.filter((name) => !samePerson(name, row.name))))
    .filter(Boolean);
  const series = [clip(input.title, 8), clip(input.logline, 22)].filter(Boolean).join(". ");
  const epNum = input.episodeNumber && input.episodeNumber > 0 ? `episode ${input.episodeNumber}` : "this episode";
  const epJob = [clip(input.episodeTitle, 8), clip(input.hook, 16), clip(input.conflict, 12)].filter(Boolean).join(". ");
  const priorEp =
    input.priorEpisode && (input.episodeNumber ?? 1) > 1
      ? [
          input.priorEpisode.number ? `episode ${input.priorEpisode.number} ended` : "the last episode ended",
          clip(input.priorEpisode.cliffhanger, 14) ?? lastSpokenLine(input.priorEpisode.last_script),
        ]
          .filter(Boolean)
          .join(": ")
      : null;
  const style = clip(input.visualStyle, 10);
  const motifs = humanMotifs(input.genreMotifs).slice(0, 2).map((row) => clip(row, 4)).filter(Boolean);
  const takeN = (input.thisTake?.index ?? 0) + 1;
  const parts = [
    series ? `SERIES: ${series}.` : null,
    epJob ? `THIS EPISODE (${epNum}): ${epJob}. Continue that fight — do not recap, do not restart.` : `THIS EPISODE (${epNum}). Continue — do not recap, do not restart.`,
    priorEp ? `BEFORE THIS EPISODE: ${priorEp}. The viewer may be new; imply, do not lecture.` : null,
    already.length
      ? `ALREADY SAID THIS EPISODE: ${already.map((line) => `"${line}"`).join(" / ")}. Do not repeat those words.`
      : takeN > 1
        ? "ALREADY SAID THIS EPISODE: they have been fighting. Do not restart the first accusation."
        : null,
    lastLine || lastNote
      ? `LAST CLIP: they just said "${lastLine ?? "the last line"}"${lastNote ? `. ${lastNote}` : ""}. Same sides, same bodies${prop ? `, same prop (${clip(prop, 8)})` : ""}. Do not reprint that last frame. Do not say that last line again.`
      : null,
    cast.length ? `CAST IN FRAME: ${cast.join(" / ")}.` : null,
    style || motifs.length ? `LOOK: ${[style, motifs.join(", ")].filter(Boolean).join("; ")}.` : null,
    `THIS CLIP is take ${takeN}. Photoreal finished location. One continuous scene, not a mash of leftover generations.`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `CONTEXT. ${parts.join(" ")}`;
}
