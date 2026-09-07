import type { EpisodePlan, StoryBible } from "../../engine/domain.ts";
import { isLongFormLength, type EpisodeLength } from "../../engine/config/catalog.ts";
import { lintLongFormEngagement } from "./engagement.ts";
import { containsEditVerb } from "../editorial/camera-sanitize.ts";
import { silenceLegal } from "../pacing/reaction-pad.ts";
import { DIALOGUE_MAX_WORDS, dialogueTooClose, sceneTakesShareSpokenBeat, wordCount } from "../types/dialogue.ts";
import { isRefusalLoop, talkProblems } from "../types/talk.ts";
import { channelMix, channelMixOk, channelOf, isLoopOpener, isOneSentence, MICRO_EPISODE } from "../types/micro-drama.ts";
import { cameraDescribesFace, speakersForSceneTake } from "../craft/prompt-fragments.ts";
import {
  BUTTON_FUNCTIONS,
  HOOK_FUNCTIONS,
  allowsTwoShot,
  isObjectInsert,
  isSceneTake,
  isWideCoverage,
  type ShotFunction,
} from "../types/editorial.ts";
import { LENGTH_BUDGETS, type LengthBudget } from "../types/pacing.ts";
import { cueRows, cueWordCount, splitCueSentences, spokenSeconds } from "../types/continuity.ts";
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

const MOTION_WORDS =
  /\b(you|don'?t|stop|where|who|why|how|what|when|liar|lied|lie|knew|never|again|enough|get out|leave|now|dead|married|pregnant|paper|tuesday|three months|explain|admit|say it|look)\b/i;

/** A line already in motion: a question, an exclamation, or a short accusatory punch. */
export function lineInMotion(line: string | null | undefined): boolean {
  const text = (line ?? "").trim();
  if (!text) return false;
  if (/[?!]\s*$/.test(text) || text.includes("?")) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && MOTION_WORDS.test(text)) return true;
  return words.length <= 4;
}

const REVERSAL_WORDS = /\b(but|unless|until|except|not (?:my|your|his|her)|never (?:was|were)|isn'?t (?:mine|yours|his|hers)|wasn'?t (?:me|him|her)|someone|who else|whose)\b/i;

/** A button that leaves something unpaid: a question mark or a reversal. */
export function asksAQuestion(text: string | null | undefined): boolean {
  const line = (text ?? "").trim();
  if (!line) return false;
  return line.includes("?") || REVERSAL_WORDS.test(line);
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

const RESOLVE_LINE =
  /\b(it'?s over|we'?re (?:done|safe|free)|i forgive you|the end|happily|resolved|finally together|i love you too)\b/i;
const GOODBYE_LINE =
  /\b(goodbye|good night|see you|bye[,.]|i'?m leaving|walk(?:s|ing)? (?:to|toward|towards) (?:the )?door|heading (?:out|home))\b/i;
const ESTABLISH_CAMERA = /\b(establishing wide|empty wide|wide of the|sunrise|title card)\b/i;

export function picturedName(shot: ReturnType<typeof shotsOf>[number]): string | null {
  if (isObjectInsert(shot)) return null;
  if (shot.speaker_on_camera) return firstToken(shot.speaker_on_camera);
  if (shot.audio_role === "offscreen" || shot.function === "listener_hold") return null;
  return shot.speaker ? firstToken(shot.speaker) : null;
}

export function framingClass(shot: ReturnType<typeof shotsOf>[number]): string {
  const fn = shot.function;
  if (fn === "reaction" || fn === "listener_hold") return "reaction";
  if (fn === "insert_evidence" || fn === "phone_ui") return "insert";
  if (fn === "slap_peak" || fn === "doorway_reveal") return "mcu";
  if (fn === "hook_cu" || fn === "accusation_cu" || fn === "button_cu" || fn === "block_button") return "cu";
  if (/\b(medium|mcu|chest|shoulders)\b/i.test(shot.camera)) return "mcu";
  if (/\b(insert|paper|phone|object)\b/i.test(shot.camera)) return "insert";
  return "cu";
}

export function handbookBeatCount(plan: EpisodePlan): number {
  const shots = shotsOf(plan);
  const spoken: string[] = [];
  for (const shot of shots) {
    const line = shot.dialogue?.trim();
    if (!line) continue;
    if (spoken.some((prev) => dialogueTooClose(prev, line))) continue;
    spoken.push(line);
  }
  return spoken.length || Math.min(6, Math.max(1, plan.scenes.length));
}

function lintHandbookGrammar(input: {
  plan: EpisodePlan;
  shots: ReturnType<typeof shotsOf>;
  episodeNumber?: number;
  bible?: import("../../engine/domain.ts").StoryBible | null;
}): QcReport[] {
  const reports: QcReport[] = [];
  const shots = input.shots;
  const beats = handbookBeatCount(input.plan);
  reports.push(
    qc("BEAT_COUNT", beats >= 3 && beats <= 16, `${beats} beats`, "4–6 story beats (spoken turns, not shot count)", "block"),
  );

  const copiedTakes: string[] = [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const prev = shots[earlier]!;
      if (isSceneTake(shot) && isSceneTake(prev) && sceneTakesShareSpokenBeat(prev, shot)) {
        copiedTakes.push(`${earlier + 1}–${index + 1}`);
        continue;
      }
      if (shot.dialogue && prev.dialogue && dialogueTooClose(shot.dialogue, prev.dialogue) && earlier === index - 1) {
        copiedTakes.push(`${earlier + 1}–${index + 1}`);
      }
    }
  }
  reports.push(
    qc(
      "REPEAT_BEAT",
      copiedTakes.length === 0,
      copiedTakes.length ? `takes ${copiedTakes.join(", ")} copy the same spoken beat` : "each take is a new beat",
      "each scene take speaks a new beat; never generate the same script twice",
      "block",
    ),
  );

  const sceneTakesOnly = shots.length > 0 && shots.every((shot) => isSceneTake(shot));
  const mix = channelMix(shots);
  reports.push(
    qc(
      "CHANNEL_MIX",
      sceneTakesOnly || shots.length === 0 || channelMixOk(mix),
      `sync ${Math.round(mix.sync * 100)}% vo ${Math.round(mix.vo * 100)}% silent ${Math.round(mix.silent * 100)}%`,
      sceneTakesOnly ? "scene takes carry the full conversation" : "~40% sync / 30% VO / 30% silent",
      "warn",
    ),
  );
  const multi = shots.filter((shot) => !isSceneTake(shot) && channelOf(shot) === "sync" && !isOneSentence(shot.dialogue));
  reports.push(
    qc("ONE_SENTENCE", multi.length === 0, multi.length ? `${multi.length} multi-sentence sync` : "one sentence", "one sentence per sync shot", "block"),
  );
  if (input.episodeNumber === 1) {
    const leads = [
      ...new Set(
        shots.slice(0, 8).flatMap((shot) => {
          const fromScript = speakersForSceneTake({
            sceneScript: shot.scene_script,
            speaker: shot.speaker,
            speakerOnCamera: shot.speaker_on_camera,
          });
          return fromScript.length
            ? fromScript.map((name) => name.split(/\s+/)[0]!).filter(Boolean)
            : [(shot.speaker ?? "").split(/\s+/)[0]].filter(Boolean);
        }),
      ),
    ];
    reports.push(qc("LEADS_MEET", leads.length >= 2, leads.join("/") || "one face", "both leads meet in episode 1", "block"));
  }
  const core = input.bible?.logline?.trim() || input.plan.conflict?.trim() || input.plan.hook?.trim();
  reports.push(qc("CORE_EXPECTATION", Boolean(core), core ? "stated" : "missing", "one-sentence core expectation", "warn"));

  const last = shots[shots.length - 1];
  const seasonLen = input.bible?.episode_structure?.length ?? input.bible?.season?.episode_log?.length ?? 60;
  const finale = Boolean(input.episodeNumber && input.episodeNumber >= seasonLen);
  const resolves =
    !finale &&
    (RESOLVE_LINE.test(last?.dialogue ?? "") ||
      RESOLVE_LINE.test(input.plan.cliffhanger ?? "") ||
      (!asksAQuestion(input.plan.cliffhanger) && !asksAQuestion(last?.dialogue)));
  reports.push(
    qc(
      "NOTHING_RESOLVES",
      !resolves || shots.length === 0,
      last?.dialogue ?? input.plan.cliffhanger ?? "empty",
      finale ? "finale may close a thread" : "cliffhanger stays unpaid",
      "block",
    ),
  );

  for (const [index, shot] of shots.entries()) {
    if (index === 0) continue;
    const prev = shots[index - 1]!;
    const a = picturedName(prev);
    const b = picturedName(shot);
    if (a && b && a === b && framingClass(prev) === framingClass(shot) && !isSceneTake(prev) && !isSceneTake(shot)) {
      reports.push(
        qc("ADJACENT_SAME_FACE", false, `shots ${index}–${index + 1} ${a}/${framingClass(shot)}`, "cut away or change size", "block"),
      );
    }
  }

  const recap = shots.filter((shot) => shot.recap || shot.function === "establishing" || ESTABLISH_CAMERA.test(shot.camera));
  const goodbye = shots.filter((shot) => GOODBYE_LINE.test(`${shot.dialogue ?? ""} ${shot.camera}`));
  reports.push(
    qc(
      "NO_RECAP_GOODBYE",
      recap.length === 0 && goodbye.length === 0,
      recap.length ? "recap/establishing" : goodbye.length ? "goodbye/door walk" : "none",
      "no recaps, goodbyes, or walking to doors",
      "block",
    ),
  );
  return reports;
}

export function validateEpisodePlan(input: ValidatePlanInput): DramaLintResult {
  const budget: LengthBudget = LENGTH_BUDGETS[input.length ?? "60_90"];
  const shots = shotsOf(input.plan);
  const reports: QcReport[] = [];
  const cast = castSet(input);

  const shortSku = budget.target_episode_seconds <= 180;
  const handbookSku = budget.length === "60_90";
  const shortDramaSku = handbookSku || budget.length === "30_45";
  const sceneTakeCount = shots.filter((shot) => isSceneTake(shot)).length;
  const longTalk = shots.some((shot) => Boolean(shot.dialogue) && shot.duration_hint_seconds >= 12 && !isSceneTake(shot));
  const choppedSingles = handbookSku && shots.length > 0 && (sceneTakeCount !== shots.length || sceneTakeCount < budget.min_shots);
  const operaDump = !handbookSku && shortDramaSku && (sceneTakeCount >= 2 || (shots.length > 0 && shots.length < budget.min_shots));
  const operaDur = !shortDramaSku && longTalk;
  const operaTalk = !shortSku && shots.length < budget.min_shots && operaDur;
  reports.push(
    qc(
      "OPERA_PLAN",
      !choppedSingles && !operaDump && !operaDur && !operaTalk && !longTalk,
      `${shots.length} shots, ${sceneTakeCount} scene takes, max hint ${Math.max(0, ...shots.map((s) => s.duration_hint_seconds))}s`,
      handbookSku
        ? `${MICRO_EPISODE.min_shots}–${MICRO_EPISODE.max_shots} continuous scene takes of ${MICRO_EPISODE.gen_min_s}–${MICRO_EPISODE.gen_max_s}s`
        : "no ≥12s talking-head; shot count follows shotBudget",
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

  const speechOverflow = handbookSku
    ? shots.filter((shot) => isSceneTake(shot) && spokenSeconds(cueRows(shot.scene_script)) > budget.max_shot_s + 0.25)
    : [];
  reports.push(
    qc(
      "SPEECH_WINDOW",
      speechOverflow.length === 0,
      speechOverflow.length ? `${speechOverflow.length} takes over ${budget.max_shot_s}s of speech` : "each take fits the model window",
      `scene_script spoken time ≤ ${budget.max_shot_s}s`,
      "block",
    ),
  );

  // On the nose: one breath, one caption. A cue over 12 words or with two
  // sentences is where captions overflow and the viewer stops following.
  const wordyCues = handbookSku
    ? shots
        .filter((shot) => isSceneTake(shot))
        .flatMap((shot) => cueRows(shot.scene_script))
        .filter((row) => cueWordCount(row) > DIALOGUE_MAX_WORDS || splitCueSentences([row]).length > 1)
    : [];
  reports.push(
    qc(
      "ON_THE_NOSE",
      wordyCues.length === 0,
      wordyCues.length ? `${wordyCues.length} cue(s) over 12 words or two sentences` : "every cue is one short sentence",
      "every cue ≤12 words, one sentence",
      "warn",
    ),
  );

  if (handbookSku) {
    const takes = shots.filter((shot) => isSceneTake(shot));
    const looped = takes.filter((shot) => isRefusalLoop(shot.scene_script));
    const staged = takes.filter((shot) => talkProblems(shot.scene_script).some((row) => row !== "refusal-loop"));
    reports.push(
      qc(
        "STAGED_TALK",
        looped.length === 0 && staged.length === 0,
        looped.length
          ? `${looped.length} take(s) restating the same no`
          : staged.length
            ? `${staged.length} take(s) sound staged`
            : "talk is casual",
        "casual spoken English; a refusal loop blocks",
        looped.length ? "block" : "warn",
      ),
    );
    const isButton = (shot: (typeof takes)[number]) => shot.function === "button_cu" || shot === takes.at(-1);
    const mute = takes.filter((shot) => !isButton(shot) && cueRows(shot.scene_script).length < 1);
    const thin = takes.filter((shot) => !isButton(shot) && cueRows(shot.scene_script).length < 5);
    reports.push(
      qc(
        "CUE_COUNT",
        mute.length === 0 && thin.length === 0,
        mute.length
          ? `${mute.length} take(s) with an empty script`
          : thin.length
            ? `${thin.length} take(s) under 5 cues`
            : "each take has 5–8 cues",
        "5–8 cues per scene take",
        mute.length ? "block" : "warn",
      ),
    );
  }

  const faces = input.bible?.characters ?? [];
  if (faces.length) {
    const plain = faces.filter((row) => {
      const face = row.appearance?.face?.trim() ?? "";
      if (!face) return false;
      return face.length < 12 || /\b(average|plain|ordinary|tired|unremarkable|nondescript)\b/i.test(face);
    });
    reports.push(
      qc(
        "CAST_LOOK",
        plain.length === 0,
        plain.length ? `${plain.length} face(s) look average or thin` : "faces are specific beauty",
        "phone-close beauty on every named face",
        "warn",
      ),
    );
  }

  // Dialogue-first: a short drama is spoken. Under half spoken is a montage.
  const spokenShare = shots.length ? shots.filter((shot) => Boolean(shot.dialogue)).length / shots.length : 0;
  reports.push(
    qc(
      "DIALOGUE_SHARE",
      shots.length === 0 || spokenShare >= 0.45,
      `${Math.round(spokenShare * 100)}% spoken`,
      "≥45% of takes carry a line",
      "warn",
    ),
  );

  const hookIndex = Math.max(0, shots.findIndex((shot) => !shot.recap));
  const first = shots[hookIndex] ?? shots[0];
  const firstFn = first ? inferFunction(first, hookIndex, shots.length) : undefined;
  const recapSeconds = shots.filter((shot) => shot.recap).reduce((sum, shot) => sum + shot.duration_hint_seconds, 0);
  // A dialogue opener counts as a hook only if the line is already in motion:
  // a question, an accusation, an exclamation, or a short punch. "Good morning,
  // how was your flight" is not a hook even on a hook_cu.
  const inMotion = lineInMotion(first?.dialogue);
  const hookOk = shortDramaSku
    ? Boolean(first && first.dialogue && inMotion)
    : Boolean(
        first &&
          (HOOK_FUNCTIONS.has(firstFn!)
            ? !first.dialogue || inMotion
            : (first.type === "dialogue" || first.type === "hero") && inMotion),
      );
  reports.push(
    qc(
      "HOOK_3S",
      hookOk,
      first?.dialogue ? `${firstFn ?? "?"}: "${first.dialogue.slice(0, 40)}"` : firstFn ?? "missing",
      shortDramaSku
        ? "spoken hook in the first 3 seconds — a question, accusation or punch"
        : "hook_cu / insert_evidence / slap_peak, and any opening line is a question, accusation or punch",
      "block",
    ),
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
  // The button has to leave a question on the table: either the cliffhanger
  // text or the last spoken line must be an open question or a reversal.
  const buttonAsks = asksAQuestion(input.plan.cliffhanger) || asksAQuestion(buttonLine);
  reports.push(
    qc(
      "BUTTON_QUESTION",
      buttonAsks || shots.length === 0,
      buttonLine ? `"${buttonLine.slice(0, 40)}"` : input.plan.cliffhanger?.slice(0, 40) ?? "empty",
      "button line or cliffhanger is an unpaid question or reversal",
      "warn",
    ),
  );
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
  if (!hasReaction && !shortDramaSku) {
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
      !isSceneTake(shot) &&
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
    if (
      !isSceneTake(shot) &&
      shot.dialogue &&
      (wordCount(shot.dialogue) > DIALOGUE_MAX_WORDS || shot.duration_hint_seconds > budget.max_dialogue_s)
    ) {
      reports.push(
        qc(
          "MONOLOGUE",
          false,
          `${wordCount(shot.dialogue)} words / ${shot.duration_hint_seconds}s`,
          `≤${DIALOGUE_MAX_WORDS} words / ≤${budget.max_dialogue_s}s`,
          handbookSku ? "block" : "warn",
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
      /\b(slap|paper|receipt|test|mark|badge|clause|dated message|carrier|envelope|parcel|phone|letter|object|prop)\b/i.test(
        `${shot.dialogue ?? ""} ${shot.camera} ${shot.blocking?.prop ?? ""}`,
      )
    );
  });
  reports.push(qc("MUTE_FAIL", muteOk || shots.length === 0, muteOk ? "visual spike" : "speech-only", "mute-readable spike", "block"));

  const hasWide = shots.some((shot) => isWideCoverage(shot) || shot.function === "establishing" || shot.type === "establishing");
  const hasInsert = shots.some((shot, index) => isObjectInsert({ ...shot, function: inferFunction(shot, index, shots.length) }));
  const spokenFaces = shots.filter((shot) => shot.dialogue && shot.audio_role !== "offscreen" && !isSceneTake(shot));
  const ecuOnly =
    spokenFaces.length > 0 &&
    spokenFaces.every((shot) => /\b(extreme close|ecu|neck)\b/i.test(shot.camera));
  // Two-shots are not required coverage: without a locked group still they
  // invent people. They stay legal only when the plan explicitly asks for one.
  const twoShots = shots.filter((shot) => shot.function === "stacked_two");
  reports.push(
    qc(
      "COVERAGE_MIX",
      shots.length === 0 ||
        (shortDramaSku ? !hasWide && !ecuOnly : hasWide && hasInsert && !ecuOnly),
      `${hasWide ? "wide" : "no-wide"}/${hasInsert ? "insert" : "no-insert"}${ecuOnly ? "/ecu-only" : ""}`,
      shortDramaSku
        ? "no establishing/wide; jump-in or object ECU; not 100% ECU faces"
        : "≥1 empty establishing/wide, ≥1 insert, not 100% ECU faces",
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
      shortDramaSku ? "warn" : "block",
    ),
  );

  // Continuity: consecutive scenes that change location without picture to
  // carry the audience (an establishing/insert at the top of the new scene)
  // read as a jump; a time-of-day change with no bridge reads as a light jump.
  const sceneRows = input.plan.scenes;
  const unbridgedLocationJumps: string[] = [];
  const unbridgedLightJumps: string[] = [];
  for (let i = 1; i < sceneRows.length; i += 1) {
    const prev = sceneRows[i - 1]!;
    const next = sceneRows[i]!;
    const opener = next.shots[0];
    const bridged = Boolean(
      opener &&
        (isObjectInsert({ ...opener, function: inferFunction(opener, 0, next.shots.length) }) ||
          lineInMotion(opener.dialogue)),
    );
    if (norm(prev.location) !== norm(next.location) && !bridged) unbridgedLocationJumps.push(`${prev.location}→${next.location}`);
    if (norm(prev.time) !== norm(next.time) && !bridged) unbridgedLightJumps.push(`${prev.time}→${next.time}`);
  }
  reports.push(
    qc(
      "CONTINUITY_JUMP",
      unbridgedLocationJumps.length === 0,
      unbridgedLocationJumps.length ? unbridgedLocationJumps.join(", ") : "none",
      "a location change opens on an insert or jump-in-on-conflict",
      "warn",
    ),
  );
  reports.push(
    qc(
      "LIGHT_JUMP",
      unbridgedLightJumps.length === 0,
      unbridgedLightJumps.length ? unbridgedLightJumps.join(", ") : "none",
      "a time-of-day change opens on an insert or jump-in-on-conflict",
      "warn",
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

  if (handbookSku) {
    reports.push(...lintHandbookGrammar({ plan: input.plan, shots, episodeNumber: input.episodeNumber, bible: input.bible }));
  }

  // A loop opener must let a cold viewer in: the first take names at least two
  // cast members out loud. Any 7 minutes of the season should stand on its own.
  if (handbookSku && input.episodeNumber && isLoopOpener(input.episodeNumber)) {
    const first = shots.find((shot) => isSceneTake(shot));
    const script = `${first?.scene_script ?? ""} ${first?.dialogue ?? ""}`.toLowerCase();
    const cast = (input.namedCast ?? input.bible?.characters.map((row) => row.name) ?? [])
      .map((name) => name.trim().toLowerCase().split(/\s+/)[0] ?? "")
      .filter(Boolean);
    const named = cast.filter((name) => new RegExp(`\\b${name}\\b`).test(script));
    reports.push(
      qc(
        "LOOP_REANCHOR",
        cast.length < 2 || named.length >= 2,
        `${named.length} cast named in the first take`,
        "loop opener names both leads out loud in take 1",
        "warn",
      ),
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
