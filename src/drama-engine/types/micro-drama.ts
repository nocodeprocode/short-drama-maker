/** Industry blueprint for AI vertical micro dramas. One source for local and backend. */

export type DramaChannel = "sync" | "vo" | "silent";

export type CpiKind = "cliffhanger" | "gut_punch" | "lingering_question";

export type LoopSpine = {
  loop: number;
  episodes: [number, number];
  function: string;
  pleasure: string;
};

export const MICRO_EPISODE = {
  target_seconds: 90,
  min_seconds: 60,
  max_seconds: 90,
  min_shots: 4,
  max_shots: 6,
  /** A take is as long as its speech, not padded to the model max: padding is dead air. */
  gen_min_s: 10,
  gen_max_s: 15,
  used_min_s: 10,
  used_max_s: 15,
  beats_min: 4,
  beats_max: 6,
  /** One breath, one caption. On the nose. */
  max_line_words: 12,
} as const;

export const MICRO_AD_CUT = {
  target_seconds: 38,
  min_seconds: 30,
  max_seconds: 45,
  min_shots: 8,
  max_shots: 12,
  gen_min_s: 2,
  gen_max_s: 8,
} as const;

export const CHANNEL_MIX = {
  sync: { min: 0.25, max: 0.55, target: 0.4 },
  vo: { min: 0.18, max: 0.45, target: 0.3 },
  silent: { min: 0.18, max: 0.45, target: 0.3 },
} as const;

export const MICRO_PAYWALL_EPISODE = 10;
export const MICRO_LOOP_COUNT = { min: 6, max: 10 } as const;

/** 8-loop spine for a 60-episode season. Last loop absorbs leftover episodes. */
export const LOOP_SPINE: readonly LoopSpine[] = [
  { loop: 1, episodes: [1, 6], function: "Injustice established, secret planted, leads meet", pleasure: "Protagonist lands one small public counterpunch" },
  { loop: 2, episodes: [7, 12], function: "The trap tightens; paywall lands inside here", pleasure: "One ally realizes the truth" },
  { loop: 3, episodes: [13, 19], function: "A rival power enters", pleasure: "A humiliation is repaid in kind" },
  { loop: 4, episodes: [20, 26], function: "The secret partially surfaces", pleasure: "Antagonist loses control of a resource" },
  { loop: 5, episodes: [27, 33], function: "Betrayal from inside the protagonist's camp", pleasure: "The betrayer is exposed" },
  { loop: 6, episodes: [34, 40], function: "Public reveal", pleasure: "Mirror scene: loop 1 humiliation inverted" },
  { loop: 7, episodes: [41, 46], function: "Antagonist's last and worst play", pleasure: "Protagonist survives it on their own terms" },
  { loop: 8, episodes: [47, 60], function: "Collapse and settle", pleasure: "Full resolution, one door left open" },
];

export function channelOf(shot: { audio_role?: string | null; dialogue?: string | null }): DramaChannel {
  if (!shot.dialogue?.trim() || shot.audio_role === "silent") return "silent";
  if (shot.audio_role === "offscreen") return "vo";
  return "sync";
}

export function channelMix(shots: ReadonlyArray<{ audio_role?: string | null; dialogue?: string | null }>): {
  sync: number;
  vo: number;
  silent: number;
} {
  const counts = { sync: 0, vo: 0, silent: 0 };
  for (const shot of shots) counts[channelOf(shot)] += 1;
  const n = shots.length || 1;
  return { sync: counts.sync / n, vo: counts.vo / n, silent: counts.silent / n };
}

export function channelMixOk(mix: { sync: number; vo: number; silent: number }): boolean {
  return (
    mix.sync >= CHANNEL_MIX.sync.min &&
    mix.sync <= CHANNEL_MIX.sync.max &&
    mix.vo >= CHANNEL_MIX.vo.min &&
    mix.silent >= CHANNEL_MIX.silent.min
  );
}

export function isOneSentence(text: string | null | undefined): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return true;
  return trimmed.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length <= 1;
}

export function loopForEpisode(episodeNumber: number): LoopSpine {
  return LOOP_SPINE.find((row) => episodeNumber >= row.episodes[0] && episodeNumber <= row.episodes[1]) ?? LOOP_SPINE[0]!;
}

/** The first episode of a loop re-establishes who is who through conflict; a cold viewer can enter here. */
export function isLoopOpener(episodeNumber: number): boolean {
  return LOOP_SPINE.some((row) => row.episodes[0] === episodeNumber) || episodeNumber === 1;
}

/**
 * Four cliffhanger shapes in rotation, so no two consecutive episodes end the
 * same way. Milestones are pinned: paywall and finale end on a revelation, the
 * midpoint on a reversal, the all-is-lost episode on a deadline.
 */
export type CliffShape = "revelation" | "reversal" | "deadline" | "intrusion";
export const CLIFF_SHAPES: readonly CliffShape[] = ["revelation", "reversal", "deadline", "intrusion"];

export const CLIFF_SHAPE_NOTES: Record<CliffShape, string> = {
  revelation: "a fact lands that re-prices everything: a name, a face, a document, a relationship",
  reversal: "the power flips: the cornered one now holds the lever, the safe one is exposed",
  deadline: "a clock starts: a number of hours, a payment due, a door that closes at a fixed time",
  intrusion: "someone or something arrives that should not be here; cut on the face receiving it, not the arrival",
};

/** Five movements scaled to the season length; each has one job. */
export type SeasonMovement = "hook" | "setup" | "escalation" | "collapse" | "payoff";

export function seasonMovementFor(episodeNumber: number, episodeCount = 60): { movement: SeasonMovement; mission: string } {
  const n = Math.max(1, episodeCount);
  const paywall = n >= MICRO_PAYWALL_EPISODE ? MICRO_PAYWALL_EPISODE : Math.max(3, Math.round(n * 0.15));
  const midpoint = Math.round(n * 0.5);
  const collapseEnd = Math.round(n * 0.8);
  if (episodeNumber <= 3) return { movement: "hook", mission: "premise fully legible, leads meet, the lead chooses instead of reacting" };
  if (episodeNumber <= paywall) return { movement: "setup", mission: "every episode raises the price of the premise; the paywall carries the strongest revelation of act one" };
  if (episodeNumber <= midpoint) return { movement: "escalation", mission: "the secret gets harder to keep, the rival gets closer, stakes go public; midpoint flips the power" };
  if (episodeNumber <= collapseEnd) return { movement: "collapse", mission: "everything the lead built comes apart; the all-is-lost episode is a deadline that hits" };
  return { movement: "payoff", mission: "confrontation and the reveal the audience waited for; the finale still buttons into next season" };
}

export function cliffShapeFor(episodeNumber: number, episodeCount = 60): CliffShape {
  const n = Math.max(1, episodeCount);
  const paywall = n >= MICRO_PAYWALL_EPISODE ? MICRO_PAYWALL_EPISODE : Math.max(3, Math.round(n * 0.15));
  const midpoint = Math.round(n * 0.5);
  const allIsLost = Math.round(n * 0.8);
  if (episodeNumber === paywall || episodeNumber === n) return "revelation";
  if (episodeNumber === midpoint) return "reversal";
  if (episodeNumber === allIsLost) return "deadline";
  return CLIFF_SHAPES[(episodeNumber - 1) % CLIFF_SHAPES.length]!;
}

/** Job tag, social tag, contrast tag: 70% of a character before they speak. */
export const TAG_STACK_RULE =
  "Give every character a tag stack: a job tag (what they do), a social tag (protected or expendable, insider or outsider), and a contrast tag that cuts across the first two. The first sentence of the description is the on-screen label, six words or fewer.";

export function coreExpectationFrom(logline: string | null | undefined): string {
  const line = (logline ?? "").trim();
  if (!line) return "When will the room admit the name on the paper?";
  if (/[?]/.test(line)) return line.split(/[?]/)[0]!.trim() + "?";
  return `When will they face this: ${line.replace(/[.!]+$/, "")}?`;
}
