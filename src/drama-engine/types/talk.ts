import { cueRows, cueText } from "./continuity.ts";
import { dialogueTooClose } from "./dialogue.ts";
import { DROP_IN_RULES } from "./drop-in.ts";

/**
 * Short-drama talk is casual spoken English, not a formal script.
 * Imply the reason. Do not restate the same refusal three ways.
 */

const STAGED =
  /\b(it is not something|there are reasons why|i have to bring you|you have to bring|are you insane|do not bring me|don't bring me|don't take me|do not take me|i have to take you|it is not something that i can do|that is not how|i cannot go|bring me to the hospital|take me to the hospital)\b/i;

const FORMAL_CLAUSE = /\b(it is not|i cannot|do not|you will not|i will not|that is not)\b/i;

/** Closing-statement / label-read talk. "This is the envelope" is an article, not a fight. */
const ARTICLE_VOICE =
  /\b(this constitutes|constitutes a|i am informing you|i hereby|please be advised|i must inform|let me explain|for the record|the aforementioned|this document|outstanding balance|signed by my hand|that was never a (letter|document|parcel)|this is (the )?(envelope|article|parcel|writ|claim|seal|document|pack[- ]law)|this is pack)\b/i;

/** Lecturing the mechanism instead of implying it. */
const LECTURE_LORE =
  /\b(pack[- ]law (says|is|means|requires)|by pack[- ]law|under pack[- ]law|according to pack|mate[- ]claim writ|the opened writ|you broke a seal that wasn't yours|the black one,? red wax)\b/i;

/** A whole line that only names the prop — a label, not a cue. */
const LABEL_READ = /^(a |the )?(claim|writ|parcel|envelope|article|seal|letter)\.?$/i;

const REFUSAL_ISH =
  /\b((don't|do not)\s+(take|bring) me|i have to (take|bring) you|no,?\s+don't\b|hospital|there are reasons|i (can't|cannot) go)\b/i;

export function soundsStaged(text: string | null | undefined): boolean {
  const line = (text ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!line) return false;
  if (STAGED.test(line)) return true;
  if (ARTICLE_VOICE.test(line) || LECTURE_LORE.test(line) || LABEL_READ.test(line)) return true;
  if (FORMAL_CLAUSE.test(line) && !/\b(it's|i'm|don't|can't|won't|that's|you're|we're)\b/i.test(line)) return true;
  return false;
}

/** Same refusal said twice, or three refusal lines in one take — the hospital loop. */
export function isRefusalLoop(script?: string | null): boolean {
  const rows = cueRows(script).map((row) => cueText(row).replace(/\([^)]*\)/g, " ").trim());
  if (rows.filter((row) => REFUSAL_ISH.test(row)).length >= 3) return true;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (dialogueTooClose(rows[i], rows[j]) && REFUSAL_ISH.test(rows[i] ?? "")) return true;
    }
  }
  return false;
}

/** Keep a polish rewrite only if it stays long enough and does not make talk worse. */
export function acceptPolishedTalk(before: string, next: string): boolean {
  const nextCues = cueRows(next).length;
  if (nextCues < 3) return false;
  if (nextCues < 5 && cueRows(before).length >= 5) return false;
  if (talkProblems(next).length > talkProblems(before).length) return false;
  return true;
}

type TalkPlanShot = { edit_mode?: string | null; scene_script?: string | null };
type TalkPlan = { scenes: Array<{ shots: TalkPlanShot[] }> };

/**
 * Polish must not swallow a staged plan. If the copywriter throws and the
 * current scripts already fail talkProblems, rethrow so assertDramaPlan blocks.
 * A clean plan can keep the pre-polish scripts.
 */
export function keepPlanAfterPolishFailure<T extends TalkPlan>(plan: T, _error?: unknown): T {
  const dirty = plan.scenes.some((scene) =>
    scene.shots.some((shot) => shot.edit_mode === "scene_take" && talkProblems(shot.scene_script).length > 0),
  );
  if (dirty) {
    throw new Error("Polish failed while talk is staged; refusing to keep a dirty plan");
  }
  return plan;
}

export function talkProblems(script?: string | null): string[] {
  const out: string[] = [];
  const rows = cueRows(script);
  for (const row of rows) {
    const spoken = cueText(row).replace(/\([^)]*\)/g, " ").trim();
    if (soundsStaged(spoken)) out.push(spoken);
  }
  if (isRefusalLoop(script)) out.push("refusal-loop");
  return out;
}

export const TALK_RULES = `TALK like two people in a room who already know the fight — not a lawyer, not an article, not a closing statement.
- Contractions: can't, don't, I'm, you're. Never "It is not something I can do."
- Imply the reason once. Do not restate the same no three ways.
  BAD: Don't take me to the hospital. / I have to take you. / No, don't. / There are reasons I can't go.
  GOOD: I can't go there. / You're burning up. / Not that place. / If they see me I'm done.
- Spoken accusation. Interrupt, deflect, flip status. Imply the mechanism — do not lecture lore nouns like a label.
  BAD: Then this document constitutes a payment toward the outstanding balance.
  GOOD: Are you trying to bribe me?
  BAD: That was never a letter. / A claim. / Signed by my hand. / The black one, red wax.
  GOOD: You opened it. / So what is it? / Don't play dumb.
  BAD: This is the envelope. / This is pack law. / I am informing you. / The aforementioned. / You broke a seal that wasn't yours.
  GOOD: You knew I'd open it. / Then why pay my sister?
- Casual, short, easy English. No slang, no idiom, no "spill the beans."
- Same mouth does not wait. Two thoughts in a row are one breath, one sentence, or the model pauses like an avatar.
  BAD: I opened your envelope. / It was already cracked, so don't start.
  GOOD: I opened your envelope — it was already cracked, so don't start.
- One new fact or turn per line. Answer by deflecting, lying, or flipping status — not by repeating the ask.
- Say a name at most once per take, and only when it lands. Never "Name, you don't get this."
- Never name-drop someone the viewer has not met on camera this episode. Prefer role + relationship: "your sister", "the woman in the doorway", "the one who sent the envelope". If they must exist, put them in the doorway with a full-page entrance and one identifying line.
${DROP_IN_RULES}
- Never write a character saying "says" or reading a label.`;
