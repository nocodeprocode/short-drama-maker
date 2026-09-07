import { cueRows, cueText } from "../../drama-engine/types/continuity.ts";
import type { TakeAnalysis } from "./take-analysis.ts";

/**
 * Seedance must not speak a character name as a label ("Mara says").
 * A lead name is only legal when the planned cue text already speaks it.
 */
const NAME_SAYS = /\b([A-Za-z][A-Za-z']{1,24})\s+says\b/i;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function spokenScriptPlain(script?: string | null): string {
  return cueRows(script)
    .map((row) => cueText(row).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function nameLeakReasons(
  transcript: string | null | undefined,
  input: { namedCast?: readonly string[] | null; script?: string | null; speakers?: readonly string[] | null },
): string[] {
  const text = (transcript ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const reasons: string[] = [];
  const names = [...new Set([...(input.namedCast ?? []), ...(input.speakers ?? [])].map(firstName).filter(Boolean))];
  if (NAME_SAYS.test(text) && names.some((name) => new RegExp(`\\b${escapeName(name)}\\s+says\\b`, "i").test(text))) {
    reasons.push("name_label_spoken");
  }
  const planned = spokenScriptPlain(input.script);
  for (const name of names) {
    const heard = new RegExp(`\\b${escapeName(name)}\\b`, "i").test(text);
    const allowed = new RegExp(`\\b${escapeName(name)}\\b`, "i").test(planned);
    if (heard && !allowed) reasons.push("name_spoken");
  }
  return [...new Set(reasons)];
}

/**
 * FaceTime-close / stacked join. A wide-master face is much smaller than this
 * on a 9:16 frame. Take 0 may open wider; take index > 0 may not.
 */
export const JOIN_CUT_FACE_MIN_HEIGHT = 0.16;

export function joinCutFailReasons(
  analysis: Pick<TakeAnalysis, "face_box" | "face_count">,
  takeIndex: number,
): string[] {
  if (takeIndex <= 0) return [];
  const box = analysis.face_box;
  if (box && box.height < JOIN_CUT_FACE_MIN_HEIGHT) return ["join_cut_wide"];
  if (!box && analysis.face_count === 0) return ["join_cut_wide"];
  return [];
}

export function sceneTakeObedienceReasons(input: {
  transcript?: string | null;
  namedCast?: readonly string[] | null;
  speakers?: readonly string[] | null;
  script?: string | null;
  analysis?: Pick<TakeAnalysis, "face_box" | "face_count"> | null;
  takeIndex?: number;
}): string[] {
  const leaks = nameLeakReasons(input.transcript, {
    namedCast: input.namedCast,
    speakers: input.speakers,
    script: input.script,
  });
  const join = input.analysis != null && input.takeIndex != null
    ? joinCutFailReasons(input.analysis, input.takeIndex)
    : [];
  return [...leaks, ...join];
}
