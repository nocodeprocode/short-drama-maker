import type { EpisodePlan, ShotPlanScene } from "../../engine/domain.ts";
import { isLongFormLength } from "../../engine/config/catalog.ts";
import {
  EMOTION_NODE_MAX_GAP_SECONDS,
  hookLedgerMonotonic,
  LONG_BLOCK_COUNT,
  type EpisodeOutline,
} from "../plans/long-form.ts";
import { qc, type QcReport } from "../types/qc-drama.ts";
import type { EpisodeLength } from "../../engine/config/catalog.ts";

type PlanShot = ShotPlanScene["shots"][number];

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function blockIndexOf(scene: ShotPlanScene, sceneIndex: number): number {
  return scene.block_index ?? scene.shots[0]?.block_index ?? sceneIndex;
}

function isEmotionNode(shot: PlanShot, indexInBlock: number, blockShotCount: number): boolean {
  const fn = shot.function;
  if (
    fn === "insert_evidence" ||
    fn === "phone_ui" ||
    fn === "slap_peak" ||
    fn === "doorway_reveal" ||
    fn === "block_button" ||
    fn === "button_cu" ||
    fn === "reaction"
  ) {
    return true;
  }
  if (indexInBlock === 0 || indexInBlock === blockShotCount - 1) return true;
  if (shot.dialogue && /[?]/.test(shot.dialogue)) return true;
  return false;
}

function spokenSet(shots: PlanShot[]): Set<string> {
  return new Set(
    shots
      .map((shot) => shot.dialogue)
      .filter((line): line is string => Boolean(line?.trim()))
      .map(norm),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter += 1;
  return inter / new Set([...a, ...b]).size;
}

export function lintLongFormEngagement(input: {
  plan: EpisodePlan;
  length?: EpisodeLength;
}): QcReport[] {
  if (!isLongFormLength(input.length)) return [];
  const reports: QcReport[] = [];
  const outline: EpisodeOutline | undefined = input.plan.outline;
  const scenes = input.plan.scenes;
  const blocks = new Map<number, { scene: ShotPlanScene; shots: PlanShot[] }>();
  for (const [sceneIndex, scene] of scenes.entries()) {
    const index = blockIndexOf(scene, sceneIndex);
    const prev = blocks.get(index);
    if (prev) prev.shots.push(...scene.shots);
    else blocks.set(index, { scene, shots: [...scene.shots] });
  }
  const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]);
  reports.push(
    qc(
      "BLOCK_BUTTON",
      ordered.length >= LONG_BLOCK_COUNT.min,
      `${ordered.length} blocks`,
      `${LONG_BLOCK_COUNT.min}–${LONG_BLOCK_COUNT.max} scene-blocks`,
      "block",
    ),
  );

  for (const [index, { shots }] of ordered) {
    const last = shots.at(-1);
    const lastBlock = index === ordered[ordered.length - 1]?.[0];
    const ok = lastBlock
      ? last?.function === "button_cu" || last?.type === "hero"
      : last?.function === "block_button";
    if (!ok) {
      reports.push(
        qc(
          "BLOCK_BUTTON",
          false,
          `block ${index} ends ${last?.function ?? last?.type ?? "empty"}`,
          lastBlock ? "episode end = button_cu" : "non-final block ends block_button",
          "block",
        ),
      );
    }
  }

  const extraEpisodeButtons = scenes
    .flatMap((scene) => scene.shots)
    .filter((shot, index, all) => shot.function === "button_cu" && index < all.length - 1);
  if (extraEpisodeButtons.length) {
    reports.push(
      qc(
        "BLOCK_BUTTON",
        false,
        `${extraEpisodeButtons.length} mid-episode button_cu`,
        "button_cu only on the true episode end",
        "block",
      ),
    );
  }

  let clock = 0;
  let lastNode = 0;
  let worstGap = 0;
  for (const [, { shots }] of ordered) {
    for (const [index, shot] of shots.entries()) {
      clock += shot.duration_hint_seconds;
      if (isEmotionNode(shot, index, shots.length)) {
        worstGap = Math.max(worstGap, clock - lastNode);
        lastNode = clock;
      }
    }
  }
  worstGap = Math.max(worstGap, clock - lastNode);
  reports.push(
    qc(
      "EMOTION_GAP",
      worstGap <= EMOTION_NODE_MAX_GAP_SECONDS,
      `${worstGap.toFixed(1)}s gap`,
      `emotion node every ≤${EMOTION_NODE_MAX_GAP_SECONDS}s`,
      "block",
    ),
  );

  const mid =
    outline?.blocks.find((block) => block.reprice) ??
    outline?.blocks[outline.mid_reprice_index];
  const inferredReprice = ordered.some(([index, { shots }]) => {
    if (Math.abs(index - Math.round(ordered.length / 2)) > 2) return false;
    return shots.some(
      (shot) =>
        shot.function === "insert_evidence" ||
        shot.function === "phone_ui" ||
        /second name|reprice|not the last/i.test(shot.dialogue ?? ""),
    );
  });
  reports.push(
    qc(
      "MID_REPRICE",
      Boolean(mid || inferredReprice),
      mid ? `block ${mid.index}` : inferredReprice ? "inferred" : "missing",
      "mid-episode reprice ~7–8 min",
      "block",
    ),
  );

  const ledgerOk = outline ? hookLedgerMonotonic(outline.blocks) : ordered.length >= LONG_BLOCK_COUNT.min;
  reports.push(
    qc(
      "HOOK_LEDGER",
      ledgerOk,
      ledgerOk ? "monotonic" : "flat ledger",
      "each block closes ≥1 hook and opens a higher one",
      "block",
    ),
  );

  const spoken = ordered.map(([, { shots }]) => spokenSet(shots));
  let copies = 0;
  for (let i = 1; i < spoken.length; i++) {
    if (jaccard(spoken[0]!, spoken[i]!) >= 0.7) copies += 1;
  }
  const sameTitles =
    outline && new Set(outline.blocks.map((block) => norm(block.title))).size <= Math.max(2, Math.floor(outline.blocks.length / 4));
  reports.push(
    qc(
      "REPEAT_BEAT",
      copies < 4 && !sameTitles,
      copies >= 4 ? `${copies + 1} copied kitchen arguments` : sameTitles ? "repeated block titles" : "escalating",
      "blocks escalate; not 15 copies of one argument",
      "block",
    ),
  );

  return reports;
}

export function repeatedKitchenPlan(plan: EpisodePlan, copies = 15): EpisodePlan {
  const seed = plan.scenes[0] ?? {
    location: "night kitchen",
    time: "night",
    characters: ["Mara", "Eli", "Jules"],
    shots: [],
  };
  const scenes = Array.from({ length: copies }, (_, index) => ({
    ...seed,
    block_index: index,
    kind: index === copies - 1 ? ("button" as const) : ("dialogue" as const),
    shots: seed.shots.map((shot) => ({
      ...shot,
      block_index: index,
      function: index === copies - 1 && shot === seed.shots.at(-1) ? "button_cu" : shot.function,
    })),
  }));
  return {
    ...plan,
    outline: {
      target_seconds: 900,
      mid_reprice_index: -1,
      blocks: scenes.map((_, index) => ({
        index,
        title: "The paper",
        hook: "Look at Tuesday.",
        friction: "He denies it.",
        spike: "Same paper again.",
        button: "Look at Tuesday.",
        closes_hook: "Is the paper real?",
        opens_hook: "Is the paper real?",
        reprice: false,
        target_seconds: 60,
      })),
    },
    scenes,
  };
}
