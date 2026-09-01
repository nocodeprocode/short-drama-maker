import type { EpisodeLength } from "../../engine/config/catalog.ts";
import type { EpisodePlan, ShotPlanScene, StoryBible } from "../../engine/domain.ts";

export const LONG_BLOCK_SECONDS = { min: 50, max: 75, typical: 60 } as const;
export const LONG_BLOCK_COUNT = { min: 12, max: 18 } as const;
export const EMOTION_NODE_MAX_GAP_SECONDS = 30;

export type EpisodeOutlineBlock = {
  index: number;
  title: string;
  hook: string;
  friction: string;
  spike: string;
  button: string;
  closes_hook: string;
  opens_hook: string;
  reprice: boolean;
  target_seconds: number;
};

export type EpisodeOutline = {
  target_seconds: number;
  blocks: EpisodeOutlineBlock[];
  mid_reprice_index: number;
};

/** Locked-take count from finished picture. 8–12 is only legal for a 60s chapter. */
export function shotBudget(durationSeconds: number): { min_shots: number; max_shots: number } {
  if (durationSeconds <= 45) return { min_shots: 6, max_shots: 8 };
  if (durationSeconds <= 90) return { min_shots: 8, max_shots: 12 };
  if (durationSeconds <= 180) return { min_shots: 14, max_shots: 20 };
  return {
    min_shots: Math.round(durationSeconds / 7.5),
    max_shots: Math.round(durationSeconds / 4.5),
  };
}

export function isLongFormLength(length: EpisodeLength | undefined): boolean {
  return length === "900_1080";
}

export function blockCountFor(durationSeconds: number): { min: number; max: number } {
  if (durationSeconds < 400) return { min: 1, max: 3 };
  return { min: LONG_BLOCK_COUNT.min, max: LONG_BLOCK_COUNT.max };
}

export function midRepriceIndex(blockCount: number): number {
  return Math.max(5, Math.min(blockCount - 3, Math.round(blockCount * 0.5)));
}

export function hookLedgerMonotonic(blocks: EpisodeOutlineBlock[]): boolean {
  if (blocks.length < 2) return false;
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1]!;
    const cur = blocks[i]!;
    if (!cur.closes_hook.trim() || !cur.opens_hook.trim()) return false;
    if (cur.opens_hook.trim() === prev.closes_hook.trim()) return false;
    if (cur.closes_hook.trim() === prev.closes_hook.trim() && cur.opens_hook.trim() === prev.opens_hook.trim()) {
      return false;
    }
  }
  return true;
}

export function chunkBlocks<T>(blocks: T[], size = 3): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}

export function shotsForBlock(plan: EpisodePlan, blockIndex: number): ShotPlanScene["shots"] {
  return plan.scenes.filter((scene) => scene.block_index === blockIndex).flatMap((scene) => scene.shots);
}

export function synthesizeLongOutline(input: {
  bible: StoryBible;
  targetSeconds?: number;
}): EpisodeOutline {
  const target = input.targetSeconds ?? 900;
  const count = 14;
  const names = input.bible.characters.map((row) => row.name);
  const lead = names[0] ?? "Mara";
  const wall = names[1] ?? "Eli";
  const witness = names[2] ?? "Jules";
  const titles = [
    "The paper",
    "Who signed",
    "The alibi",
    "Witness walks in",
    "The Tuesday count",
    "Name on the line",
    "The reprice",
    "He changes the story",
    "Phone that should not exist",
    "The mark",
    "Downstairs",
    "The second paper",
    "Who sent you",
    "The door",
  ];
  const blocks: EpisodeOutlineBlock[] = titles.map((title, index) => {
    const n = index + 1;
    return {
      index,
      title,
      hook: index === 0 ? `The Tuesday paper is already in ${lead}'s hand.` : `${lead} will not drop the last unpaid question.`,
      friction: `${wall} tries to close it. ${lead} keeps the paper in frame.`,
      spike:
        index === 6
          ? `${witness} puts a second name on the desk. The price of the lie changes.`
          : `Mute-readable paper / phone / doorway — not a speech-only twist.`,
      button:
        index === count - 1
          ? `Then whose name is on it?`
          : `If it is not ${wall}, who signed Tuesday?`,
      closes_hook: index === 0 ? "Is the paper real?" : `Stake ${n} closed: ${titles[index - 1]}`,
      opens_hook: `Stake ${n + 1} open: ${title} is not the last name.`,
      reprice: index === midRepriceIndex(count),
      target_seconds: Math.round(target / count),
    };
  });
  return { target_seconds: target, blocks, mid_reprice_index: midRepriceIndex(count) };
}

function clipWords(text: string, max = 10): string {
  return text.split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

export function synthesizeBlockShots(input: {
  block: EpisodeOutlineBlock;
  bible: StoryBible;
  lastBlock: boolean;
  location?: string;
}): ShotPlanScene {
  const names = input.bible.characters.map((row) => row.name);
  const lead = names[0] ?? "Mara";
  const wall = names[1] ?? "Eli";
  const witness = names[2] ?? "Jules";
  const places = input.bible.locations.length ? input.bible.locations : ["night kitchen"];
  const loc = input.location ?? places[input.block.index % places.length] ?? "night kitchen";
  const n = input.block.index + 1;
  const title = input.block.title;
  const buttonFn = input.lastBlock ? "button_cu" : "block_button";
  const pressLine = input.block.reprice
    ? `${witness} put a second name down.`
    : `Then say who wrote ${title.toLowerCase()}.`;
  const wallLine = input.block.index === 0 ? "I did not write the paper." : `I did not write ${title.toLowerCase()}.`;
  const offscreen = `${wall}, ${title.toLowerCase()} still has a name.`;
  const emotional = n % 3 === 2;
  const wideCamera = /lobby|estate|banquet|castle/i.test(loc)
    ? `establishing wide of ${loc}, marble, chandelier, empty room, no people`
    : `establishing wide of ${loc}, island and window, empty room, no people`;
  const shots: ShotPlanScene["shots"] = [
    input.block.index === 0
      ? {
          type: "broll" as const,
          speaker: null,
          dialogue: null,
          emotion: null,
          delivery: null,
          pace: null,
          camera: "insert of unlabeled paper on dark stone, handwritten TUESDAY only, no people",
          mouth_visibility_required: false,
          duration_hint_seconds: 4,
          function: "hook_cu" as const,
          audio_role: "silent" as const,
          edit_mode: "locked_take" as const,
          eyeline: "lens_forbidden" as const,
          speaker_on_camera: null,
          block_index: input.block.index,
        }
      : {
          type: "establishing" as const,
          speaker: null,
          dialogue: null,
          emotion: null,
          delivery: null,
          pace: null,
          camera: wideCamera,
          mouth_visibility_required: false,
          duration_hint_seconds: 4,
          function: "establishing" as const,
          audio_role: "silent" as const,
          edit_mode: "locked_take" as const,
          eyeline: "lens_forbidden" as const,
          camera_move: "slow push",
          speaker_on_camera: null,
          block_index: input.block.index,
        },
    {
      type: input.block.index === 0 ? "establishing" : "broll",
      speaker: null,
      dialogue: null,
      emotion: null,
      delivery: null,
      pace: null,
      camera:
        input.block.index === 0
          ? wideCamera
          : "insert of a water glass tipping, no faces, object only",
      mouth_visibility_required: false,
      duration_hint_seconds: 3.5,
      function: input.block.index === 0 ? "establishing" : "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      camera_move: "slow push",
      sfx: input.block.index === 0 ? null : "glass",
      comic_sting: input.block.index !== 0,
      block_index: input.block.index,
    },
    {
      type: "establishing",
      speaker: null,
      dialogue: null,
      emotion: "waiting",
      delivery: null,
      pace: null,
      camera: `silent two-shot, ${lead} and ${wall} across the ${loc}, faces small, mouths closed`,
      mouth_visibility_required: false,
      duration_hint_seconds: 3.5,
      function: "stacked_two",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      camera_move: "slow pull",
      block_index: input.block.index,
    },
    {
      type: "dialogue",
      speaker: lead,
      dialogue: `${wall}, look at Tuesday.`,
      emotion: emotional ? "break" : "hot",
      delivery: emotional ? "cry" : "shout",
      pace: "fast",
      camera: `medium close-up on ${lead}, ivory, same ${loc} key light`,
      mouth_visibility_required: true,
      duration_hint_seconds: 6,
      function: "accusation_cu",
      audio_role: "onscreen",
      edit_mode: "locked_take",
      eyeline: "left_of_camera",
      speaker_on_camera: lead,
      camera_move: "slow push",
      block_index: input.block.index,
    },
    {
      type: "reaction",
      speaker: wall,
      dialogue: null,
      emotion: "the line lands",
      delivery: null,
      pace: null,
      camera: `medium close-up on ${wall}, charcoal henley, same ${loc}`,
      mouth_visibility_required: false,
      duration_hint_seconds: 2.5,
      function: "reaction",
      audio_role: "silent",
      silence_license: "post_nuke",
      edit_mode: "locked_take",
      eyeline: "down",
      speaker_on_camera: wall,
      block_index: input.block.index,
    },
    {
      type: "dialogue",
      speaker: wall,
      dialogue: wallLine,
      emotion: "stunned",
      delivery: "fast",
      pace: "fast",
      camera: `medium close-up on ${wall}, same ${loc} grade`,
      mouth_visibility_required: true,
      duration_hint_seconds: 6,
      function: "accusation_cu",
      audio_role: "onscreen",
      edit_mode: "locked_take",
      eyeline: "right_of_camera",
      speaker_on_camera: wall,
      sfx: "comic",
      comic_sting: true,
      block_index: input.block.index,
    },
    {
      type: "broll",
      speaker: null,
      dialogue: null,
      emotion: "stun",
      delivery: null,
      pace: null,
      camera: "insert of unlabeled paper, handwritten TUESDAY, no people",
      mouth_visibility_required: false,
      duration_hint_seconds: 3.5,
      function: n % 3 === 0 ? "phone_ui" : "insert_evidence",
      audio_role: "silent",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      sfx: "paper",
      comic_sting: true,
      block_index: input.block.index,
    },
    {
      type: "dialogue",
      speaker: lead,
      dialogue: pressLine,
      emotion: emotional ? "cry" : input.block.reprice ? "cold" : "pressing",
      delivery: emotional ? "break" : "quiet",
      pace: "slow",
      camera: `medium close-up on ${lead}, same ${loc}`,
      mouth_visibility_required: true,
      duration_hint_seconds: 6,
      function: "accusation_cu",
      audio_role: "onscreen",
      edit_mode: "locked_take",
      eyeline: "left_of_camera",
      speaker_on_camera: lead,
      camera_move: "slow push",
      block_index: input.block.index,
    },
    {
      type: "reaction",
      speaker: wall,
      dialogue: offscreen,
      emotion: "listening",
      delivery: "under",
      pace: "slow",
      camera: `listener hold on ${wall}, mouth closed, same ${loc}`,
      mouth_visibility_required: false,
      duration_hint_seconds: 4,
      function: "listener_hold",
      audio_role: "offscreen",
      speakers_off_camera: [lead],
      speaker_on_camera: wall,
      edit_mode: "locked_take",
      eyeline: "down",
      block_index: input.block.index,
    },
    {
      type: "dialogue",
      speaker: lead,
      dialogue: clipWords(input.block.button) || `Then whose name is on ${title.toLowerCase()}?`,
      emotion: "unpaid",
      delivery: "still",
      pace: "slow",
      camera: `medium close-up on ${lead}, same ${loc} key light`,
      mouth_visibility_required: true,
      duration_hint_seconds: 5.5,
      function: buttonFn,
      audio_role: "onscreen",
      edit_mode: "locked_take",
      eyeline: "lens_forbidden",
      speaker_on_camera: lead,
      hero: input.lastBlock,
      camera_move: "slow push",
      block_index: input.block.index,
    },
  ];
  return {
    location: loc,
    time: "night",
    characters: names.slice(0, 3),
    kind: input.lastBlock ? "button" : "dialogue",
    block_index: input.block.index,
    shots,
  };
}

export function assemblePlanFromBlocks(input: {
  title: string;
  outline: EpisodeOutline;
  scenes: ShotPlanScene[];
}): EpisodePlan {
  const first = input.outline.blocks[0];
  const last = input.outline.blocks.at(-1);
  return {
    title: input.title,
    hook: first?.hook ?? "The turn is already happening.",
    conflict: "The lie keeps a higher price each block.",
    cliffhanger: last?.button ?? "Then whose name is on it?",
    outline: input.outline,
    scenes: input.scenes,
  };
}

export function commercialLongPlan(bible: StoryBible, title?: string): EpisodePlan {
  const outline = synthesizeLongOutline({ bible, targetSeconds: 900 });
  const scenes = outline.blocks.map((block, index) =>
    synthesizeBlockShots({
      block,
      bible,
      lastBlock: index === outline.blocks.length - 1,
    }),
  );
  return assemblePlanFromBlocks({ title: title ?? bible.title, outline, scenes });
}

export async function planLongFormEpisode(input: {
  bible: StoryBible;
  episodeNumber: number;
  title?: string;
  outlineEpisode?: (input: {
    bible: StoryBible;
    episodeNumber: number;
  }) => Promise<EpisodeOutline>;
  writeEpisodeBlocks?: (input: {
    bible: StoryBible;
    outline: EpisodeOutline;
    blocks: EpisodeOutlineBlock[];
  }) => Promise<ShotPlanScene[]>;
}): Promise<EpisodePlan> {
  let outline: EpisodeOutline;
  try {
    outline = input.outlineEpisode
      ? await input.outlineEpisode({ bible: input.bible, episodeNumber: input.episodeNumber })
      : synthesizeLongOutline({ bible: input.bible });
  } catch {
    outline = synthesizeLongOutline({ bible: input.bible });
  }
  if (outline.blocks.length < LONG_BLOCK_COUNT.min || outline.blocks.length > LONG_BLOCK_COUNT.max) {
    outline = synthesizeLongOutline({ bible: input.bible });
  }
  if (!outline.blocks.some((block) => block.reprice)) {
    const mid = midRepriceIndex(outline.blocks.length);
    outline = {
      ...outline,
      mid_reprice_index: mid,
      blocks: outline.blocks.map((block, index) => ({ ...block, reprice: index === mid })),
    };
  }
  const scenes: ShotPlanScene[] = [];
  for (const batch of chunkBlocks(outline.blocks, 3)) {
    try {
      const planned = input.writeEpisodeBlocks
        ? await input.writeEpisodeBlocks({ bible: input.bible, outline, blocks: batch })
        : batch.map((block) =>
            synthesizeBlockShots({
              block,
              bible: input.bible,
              lastBlock: block.index === outline.blocks.length - 1,
            }),
          );
      if (!planned.length) throw new Error("empty block batch");
      scenes.push(...planned.map((scene, index) => ({
        ...scene,
        block_index: scene.block_index ?? batch[index]?.index,
        shots: scene.shots.map((shot) => ({
          ...shot,
          block_index: shot.block_index ?? scene.block_index ?? batch[index]?.index,
        })),
      })));
    } catch {
      scenes.push(
        ...batch.map((block) =>
          synthesizeBlockShots({
            block,
            bible: input.bible,
            lastBlock: block.index === outline.blocks.length - 1,
          }),
        ),
      );
    }
  }
  return assemblePlanFromBlocks({
    title: input.title ?? input.bible.title,
    outline,
    scenes,
  });
}
