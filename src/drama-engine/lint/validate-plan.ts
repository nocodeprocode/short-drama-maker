import type { EpisodePlan, StoryBible } from "../../engine/domain.ts";
import { isLongFormLength, type EpisodeLength } from "../../engine/config/catalog.ts";
import { lintLongFormEngagement } from "./engagement.ts";
import { containsEditVerb } from "../editorial/camera-sanitize.ts";
import { silenceLegal } from "../pacing/reaction-pad.ts";
import { DIALOGUE_MAX_WORDS, dialogueTooClose, wordCount } from "../types/dialogue.ts";
import { cameraDescribesFace } from "../craft/prompt-fragments.ts";
import {
  BUTTON_FUNCTIONS,
  HOOK_FUNCTIONS,
  allowsTwoShot,
  isObjectInsert,
  isWideCoverage,
  type ShotFunction,
} from "../types/editorial.ts";
import { LENGTH_BUDGETS, type LengthBudget } from "../types/pacing.ts";
import type { CharacterJob } from "../types/genre.ts";
import { qc, type DramaLintResult, type QcReport } from "../types/qc-drama.ts";
import type { EpisodeKind } from "../types/story.ts";

export type ValidatePlanInput = {
  plan: EpisodePlan;
  bible?: StoryBible | null;
  length?: EpisodeLength;
  namedCast?: string[];
  jobs?: Record<string, CharacterJob>;
  episodeKind?: EpisodeKind;
  episodeNumber?: number;
  hookLedgerCloses?: number;
  hookLedgerOpens?: number;
};

function shotsOf(plan: EpisodePlan) {
  return plan.scenes.flatMap((scene) => scene.shots);
}

function norm(name: string): string {
  return name.trim().toLowerCase();
}

function firstToken(name: string): string {
  return norm(name).split(/\s+/)[0] ?? "";
}

function castSet(input: ValidatePlanInput): Set<string> {
  const names = input.namedCast?.length
    ? input.namedCast
    : (input.bible?.characters ?? []).map((row) => row.name);
  const set = new Set<string>();
  for (const name of names) {
    set.add(norm(name));
    set.add(firstToken(name));
  }
  return set;
}

function inferFunction(shot: ReturnType<typeof shotsOf>[number], index: number, total: number): ShotFunction {
  if (shot.function) return shot.function;
  if (index === 0) return "hook_cu";
  if (index === total - 1) return "button_cu";
  if (shot.type === "reaction") return "reaction";
  if (shot.type === "broll") return "insert_evidence";
  return "accusation_cu";
}

function looksIntoLens(camera: string, eyeline?: string | null): boolean {
  if (eyeline === "lens_forbidden") return false;
  return /\b(look(?:ing)?\s+(?:into\s+)?(?:the\s+)?(?:lens|camera|viewer)|selfie|vlog|fourth wall)\b/i.test(
    camera,
  );
}

export function validateEpisodePlan(input: ValidatePlanInput): DramaLintResult {
  const budget: LengthBudget = LENGTH_BUDGETS[input.length ?? "60_90"];
  const shots = shotsOf(input.plan);
  const reports: QcReport[] = [];
  const cast = castSet(input);

  const shortSku = budget.target_episode_seconds <= 180;
  const operaCount = shortSku && shots.length >= 16;
  const operaDur = shots.some((shot) => shot.duration_hint_seconds >= 12);
  const operaTalk = !shortSku && shots.length < budget.min_shots && operaDur;
  reports.push(
    qc(
      "OPERA_PLAN",
      !operaCount && !operaDur && !operaTalk,
      `${shots.length} shots, max hint ${Math.max(0, ...shots.map((s) => s.duration_hint_seconds))}s`,
      shortSku ? "≤12 shots and ≤10s per take" : "no ≥12s talking-head; shot count follows shotBudget",
      "block",
    ),
  );

  reports.push(
    qc(
      "SHOT_BUDGET",
      shots.length >= budget.min_shots && shots.length <= budget.max_shots,
      String(shots.length),
      `${budget.min_shots}–${budget.max_shots}`,
      "block",
    ),
  );

  const sum = shots.reduce((acc, shot) => acc + shot.duration_hint_seconds, 0);
  reports.push(
    qc(
      "DURATION_WINDOW",
      sum >= budget.duration_sum_min && sum <= budget.duration_sum_max,
      `${sum}s`,
      `${budget.duration_sum_min}–${budget.duration_sum_max}s`,
      "block",
    ),
  );

  const hookIndex = Math.max(0, shots.findIndex((shot) => !shot.recap));
  const first = shots[hookIndex] ?? shots[0];
  const firstFn = first ? inferFunction(first, hookIndex, shots.length) : undefined;
  const recapSeconds = shots.filter((shot) => shot.recap).reduce((sum, shot) => sum + shot.duration_hint_seconds, 0);
  const hookOk = Boolean(first && (HOOK_FUNCTIONS.has(firstFn!) || first.type === "dialogue" || first.type === "hero"));
  reports.push(
    qc("HOOK_3S", hookOk, firstFn ?? "missing", "hook_cu / insert_evidence / slap_peak / in-motion dialogue", "block"),
  );
  if (input.episodeNumber && input.episodeNumber >= 2 && recapSeconds > 4.05) {
    reports.push(qc("HOOK_3S", false, `${recapSeconds}s recap`, "recap ≤4s, never replaces hook", "block"));
  }

  const last = shots[shots.length - 1];
  const lastFn = last ? inferFunction(last, shots.length - 1, shots.length) : undefined;
  const buttonOk = Boolean(
    input.plan.cliffhanger?.trim() && last && (BUTTON_FUNCTIONS.has(lastFn!) || last.type === "hero"),
  );
  reports.push(
    qc(
      "NO_BUTTON",
      buttonOk,
      `${lastFn ?? "missing"} / ${input.plan.cliffhanger ? "has cliffhanger" : "empty"}`,
      "button_cu + unresolved question",
      "block",
    ),
  );
  const extraButtons = shots.filter(
    (shot, index) => index < shots.length - 1 && inferFunction(shot, index, shots.length) === "button_cu",
  );
  reports.push(
    qc(
      "DUPLICATE_BUTTON",
      extraButtons.length === 0,
      extraButtons.length ? `${extraButtons.length} extra button_cu` : "1",
      "exactly one button_cu — the last shot",
      "block",
    ),
  );
  const buttonLine = last?.dialogue;
  const buttonNovel = !dialogueTooClose(buttonLine, first?.dialogue) && !dialogueTooClose(buttonLine, input.plan.hook);
  reports.push(
    qc(
      "WEAK_BUTTON",
      !buttonLine || buttonNovel,
      buttonLine ?? "empty",
      "button line ≠ hook / first line",
      "block",
    ),
  );

  const hasReaction = shots.some((shot) => shot.type === "reaction" || shot.function === "reaction" || shot.function === "listener_hold");
  if (!hasReaction) {
    reports.push(qc("ASL_HOLD", false, "0 reaction/listener holds", "≥1 reaction", "block"));
  }

  for (const [index, shot] of shots.entries()) {
    const prev = shots[index - 1];
    const fn = inferFunction(shot, index, shots.length);
    const silenceShot = {
      ...shot,
      function: fn,
      type: index === 0 && fn === "hook_cu" && !shot.dialogue ? ("broll" as const) : shot.type,
    };
    if (!shot.dialogue && !silenceLegal(silenceShot, prev)) {
      reports.push(
        qc(
          "ILLEGAL_SILENCE",
          false,
          `shot ${index + 1} ${shot.duration_hint_seconds}s silent`,
          "licensed 1.5–3s or insert-read",
          "block",
        ),
      );
    }
    if (
      !shot.dialogue &&
      shot.duration_hint_seconds >= 4 &&
      fn !== "insert_evidence" &&
      fn !== "phone_ui" &&
      fn !== "establishing" &&
      fn !== "stacked_two" &&
      !(index === 0 && fn === "hook_cu") &&
      shot.type !== "broll" &&
      shot.type !== "establishing"
    ) {
      if (!shot.silence_license || shot.silence_license === "illegal_opera") {
        reports.push(
          qc("ASL_HOLD", false, `shot ${index + 1} ${shot.duration_hint_seconds}s silent`, "licensed reaction or insert", "block"),
        );
      }
    }
    if (looksIntoLens(shot.camera, shot.eyeline)) {
      reports.push(qc("OPERA_STARE", false, shot.camera, "eyeline ≠ lens", "block"));
    }
    if (containsEditVerb(shot.camera) && (shot.edit_mode ?? "locked_take") === "locked_take") {
      reports.push(qc("EDIT_VERB", false, shot.camera, "no Cut to / Shot N: / Hold for", "block"));
    }
    if (
      !allowsTwoShot(fn) &&
      /\b(two-shot|two shot|both of them|both characters|the couple|same frame)\b/i.test(shot.camera)
    ) {
      reports.push(qc("EDIT_VERB", false, shot.camera, "single: no two-shot / both / couple", "block"));
    }
    if (shot.speaker) {
      const known = cast.size === 0 || cast.has(norm(shot.speaker)) || cast.has(firstToken(shot.speaker));
      reports.push(
        qc("INVENTED_SPEAKER", known, shot.speaker, "named locked cast", "block"),
      );
    }
    if (
      isObjectInsert({ ...shot, function: fn }) &&
      cameraDescribesFace(shot.camera)
    ) {
      reports.push(
        qc("FACE_ON_INSERT", false, shot.camera, "object plate / no people", "warn"),
      );
    }
    if (shot.dialogue && (wordCount(shot.dialogue) > DIALOGUE_MAX_WORDS || shot.duration_hint_seconds > budget.max_dialogue_s)) {
      reports.push(
        qc(
          "MONOLOGUE",
          false,
          `${wordCount(shot.dialogue)} words / ${shot.duration_hint_seconds}s`,
          `≤${DIALOGUE_MAX_WORDS} words / ≤${budget.max_dialogue_s}s`,
          "warn",
        ),
      );
    }
  }

  const speakers = new Set(
    shots.map((shot) => shot.speaker).filter((name): name is string => Boolean(name)).map(firstToken),
  );
  const roster = input.namedCast?.length
    ? input.namedCast
    : (input.bible?.characters ?? []).map((row) => row.name);
  const rosterCount = roster.length;
  reports.push(
    qc("CAST_BLOAT", rosterCount === 0 || (rosterCount >= 3 && rosterCount <= 8), String(rosterCount || speakers.size), "3–8 named roles", "block"),
  );
  if (speakers.size > 8) {
    reports.push(qc("CAST_BLOAT", false, String(speakers.size), "≤8 speaking", "block"));
  }

  const muteOk = shots.some((shot, index) => {
    const fn = inferFunction(shot, index, shots.length);
    return (
      fn === "slap_peak" ||
      fn === "insert_evidence" ||
      fn === "phone_ui" ||
      /\b(slap|paper|receipt|test|mark|badge|clause|dated message)\b/i.test(`${shot.dialogue ?? ""} ${shot.camera}`)
    );
  });
  reports.push(qc("MUTE_FAIL", muteOk || shots.length === 0, muteOk ? "visual spike" : "speech-only", "mute-readable spike", "block"));

  const hasWide = shots.some((shot) => isWideCoverage(shot));
  const hasInsert = shots.some((shot, index) => isObjectInsert({ ...shot, function: inferFunction(shot, index, shots.length) }));
  const ecuOnly = shots.filter((shot) => shot.dialogue && shot.audio_role !== "offscreen").every((shot) =>
    /\b(tight single|extreme close|ecu|neck)\b/i.test(shot.camera),
  );
  // Two-shots are not required coverage: without a locked group still they
  // invent people. They stay legal only when the plan explicitly asks for one.
  const twoShots = shots.filter((shot) => shot.function === "stacked_two");
  reports.push(
    qc(
      "COVERAGE_MIX",
      shots.length === 0 || (hasWide && hasInsert && !ecuOnly),
      `${hasWide ? "wide" : "no-wide"}/${hasInsert ? "insert" : "no-insert"}${ecuOnly ? "/ecu-only" : ""}`,
      "≥1 empty establishing/wide, ≥1 insert, not 100% ECU faces",
      "block",
    ),
  );
  reports.push(
    qc(
      "TWO_SHOT_RISK",
      twoShots.length === 0,
      twoShots.length ? `${twoShots.length} two-shot(s)` : "none",
      "two-shots only from a locked group still",
      "warn",
    ),
  );
  const hasComic = shots.some(
    (shot) =>
      shot.comic_sting ||
      shot.sfx === "comic" ||
      shot.sfx === "stunned" ||
      shot.sfx === "glass" ||
      /\b(stun|comic|glass|big eyes|didn'?t know)\b/i.test(`${shot.camera} ${shot.emotion ?? ""} ${shot.dialogue ?? ""}`),
  );
  reports.push(
    qc(
      "COMIC_STING",
      hasComic || shots.length === 0,
      hasComic ? "comic/stun cutaway" : "accusation CUs only",
      "≥1 comic/stun cutaway + SFX per episode or block cluster",
      "block",
    ),
  );

  if (input.episodeKind === "ConfrontationEp" && input.jobs) {
    const hasWitness = Object.values(input.jobs).includes("witness");
    reports.push(qc("NO_JOB", hasWitness, hasWitness ? "witness" : "missing", "Witness on ConfrontationEp", "warn"));
  }

  if (input.episodeNumber && input.episodeNumber >= 1 && !isLongFormLength(input.length)) {
    const closes = input.hookLedgerCloses ?? 1;
    const opens = input.hookLedgerOpens ?? 1;
    reports.push(
      qc("HOOK_LEDGER", !(closes === 0 && opens === 0), `close ${closes} open ${opens}`, "close≥1 or open≥1", "block"),
    );
  }

  reports.push(...lintLongFormEngagement(input));

  const blocking = reports.filter((row) => !row.pass && row.severity === "block");
  const warnings = reports.filter((row) => !row.pass && row.severity === "warn");
  return { pass: blocking.length === 0, blocking, warnings, reports };
}

export function assertDramaPlan(input: ValidatePlanInput): EpisodePlan {
  const result = validateEpisodePlan(input);
  if (!result.pass) {
    const first = result.blocking[0];
    const sketch = shotsOf(input.plan)
      .map((shot, index) => `${index + 1}:${shot.function ?? shot.type}/${shot.duration_hint_seconds}s/${shot.dialogue ? "dlg" : "sil"}`)
      .join(" ");
    throw new Error(
      `Drama lint failed ${first?.id ?? "PLAN"}: ${first?.actual ?? "invalid"} (need ${first?.threshold ?? "valid plan"}) [${sketch}]`,
    );
  }
  return input.plan;
}
