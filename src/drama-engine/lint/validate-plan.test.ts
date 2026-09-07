import { describe, expect, it } from "vitest";
import type { EpisodePlan } from "../../engine/domain.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import { applyShotBudget, splitLongShots } from "../editorial/shot-budget.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import { isObjectInsert } from "../types/editorial.ts";
import { LINT_RULES } from "./rules.ts";
import { repairEpisodePlan } from "./repair.ts";
import { assertDramaPlan, validateEpisodePlan } from "./validate-plan.ts";
import { playbookFor } from "../craft/genre-playbooks.ts";
import { skuAllowsTrope } from "../integration/hooks.ts";
import { sceneTakesShareSpokenBeat } from "../types/dialogue.ts";
import { wordErrorRate } from "../../engine/media/qc.ts";
import { lockedTakeRejected } from "../editorial/cut-detect.ts";
import { pickTransition } from "../editorial/manifest-builder.ts";
import type { Shot } from "../../engine/domain.ts";
import { cueRows, cueText, spokenSeconds } from "../types/continuity.ts";

function shot(partial: Partial<EpisodePlan["scenes"][number]["shots"][number]> = {}): EpisodePlan["scenes"][number]["shots"][number] {
  return {
    type: "dialogue",
    speaker: "Sarah",
    dialogue: "You knew.",
    emotion: "cold",
    delivery: "quiet",
    pace: "slow",
    camera: "close-up",
    mouth_visibility_required: true,
    duration_hint_seconds: 5,
    ...partial,
  };
}

function plan(shots: EpisodePlan["scenes"][number]["shots"], extra?: Partial<EpisodePlan>): EpisodePlan {
  return {
    title: "You Knew",
    hook: "The lie is live.",
    conflict: "Three months.",
    cliffhanger: "The elevator opens on someone they both know.",
    scenes: [{ location: "penthouse kitchen", time: "night", characters: ["Sarah", "David"], shots }],
    ...extra,
  };
}

const CAST3 = ["Sarah", "David", "Nora"];

function tenShotPlan(): EpisodePlan["scenes"][number]["shots"] {
  return [
    shot({ function: "hook_cu", duration_hint_seconds: 3, dialogue: "How long?" }),
    shot({ speaker: "David", dialogue: "Don't.", duration_hint_seconds: 3 }),
    shot({
      type: "reaction",
      function: "listener_hold",
      audio_role: "offscreen",
      speaker: "David",
      speaker_on_camera: "Sarah",
      speakers_off_camera: ["David"],
      dialogue: "Three months is a confession.",
      mouth_visibility_required: false,
      duration_hint_seconds: 3,
    }),
    shot({
      type: "broll",
      function: "insert_evidence",
      speaker: null,
      dialogue: null,
      camera: "insert of the phone with the dated message",
      mouth_visibility_required: false,
      duration_hint_seconds: 3,
      audio_role: "silent",
      comic_sting: true,
      sfx: "stunned",
    }),
    shot({ speaker: "David", dialogue: "Three months.", duration_hint_seconds: 3 }),
    shot({
      type: "reaction",
      function: "reaction",
      speaker: "Sarah",
      speaker_on_camera: "Sarah",
      dialogue: null,
      camera: "Medium close-up of Sarah listening",
      duration_hint_seconds: 2,
      audio_role: "silent",
      mouth_visibility_required: false,
      silence_license: "post_nuke",
    }),
    shot({ speaker: "David", dialogue: "Sarah, look.", duration_hint_seconds: 3 }),
    shot({ speaker: "Sarah", dialogue: "Don't say my name.", function: "slap_peak", duration_hint_seconds: 3, hero: true }),
    shot({
      type: "broll",
      function: "insert_evidence",
      speaker: null,
      dialogue: null,
      camera: "insert of unlabeled paper on dark stone, object only",
      duration_hint_seconds: 3,
      audio_role: "silent",
      mouth_visibility_required: false,
    }),
    shot({ function: "button_cu", type: "hero", dialogue: "Who is she?", duration_hint_seconds: 3 }),
  ];
}

function fiveCueScript(a: string, b: string, opener: string, closer: string): string {
  return [
    `${a}: ${opener}`,
    `${b}: Don't.`,
    `${a}: Three months.`,
    `${b}: Say it.`,
    `${a}: ${closer}`,
  ].join("\n");
}

function sceneTakeShots(): EpisodePlan["scenes"][number]["shots"] {
  return [
    shot({
      function: "hook_cu",
      edit_mode: "scene_take",
      speaker: "Sarah",
      dialogue: "How long?",
      scene_script: "Sarah: How long?\nDavid: Don't.",
      duration_hint_seconds: 15,
      camera: "medium two-shot, Sarah and David in the kitchen, dated paper on the table",
    }),
    shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "David",
      dialogue: "Three months.",
      scene_script: "David: Three months.\nSarah: That is a confession.",
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated receipt on marble",
    }),
    shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "Nora",
      dialogue: "I buzzed her at eleven.",
      scene_script: "Nora: I buzzed her at eleven.\nSarah: Say the name.",
      duration_hint_seconds: 15,
      camera: "medium two-shot, Nora and Sarah, paper on the table",
    }),
    shot({
      function: "button_cu",
      edit_mode: "scene_take",
      type: "hero",
      speaker: "Sarah",
      dialogue: "Who is she?",
      scene_script: "Sarah: Who is she?",
      duration_hint_seconds: 15,
      hero: true,
      camera: "medium two-shot, dated paper on the table",
    }),
  ];
}

function legalSceneTakeShots(): EpisodePlan["scenes"][number]["shots"] {
  return [
    shot({
      function: "hook_cu",
      edit_mode: "scene_take",
      speaker: "Sarah",
      dialogue: "How long?",
      scene_script: fiveCueScript("Sarah", "David", "How long?", "Nora saw."),
      duration_hint_seconds: 15,
      camera: "medium two-shot, Sarah and David in the kitchen, dated paper on the table",
    }),
    shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "David",
      dialogue: "Three months.",
      scene_script: fiveCueScript("David", "Sarah", "Three months.", "Look at me."),
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated receipt on marble",
    }),
    shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "Nora",
      dialogue: "I buzzed her at eleven.",
      scene_script: fiveCueScript("Nora", "Sarah", "I buzzed her at eleven.", "Say the name."),
      duration_hint_seconds: 15,
      camera: "medium two-shot, Nora and Sarah, paper on the table",
    }),
    shot({
      function: "button_cu",
      edit_mode: "scene_take",
      type: "hero",
      speaker: "Sarah",
      dialogue: "Who is she?",
      scene_script: "Sarah: Who is she?",
      duration_hint_seconds: 15,
      hero: true,
      camera: "medium two-shot, dated paper on the table",
    }),
  ];
}

function handbookShots(): EpisodePlan["scenes"][number]["shots"] {
  const lines: Array<Partial<EpisodePlan["scenes"][number]["shots"][number]>> = [
    { function: "hook_cu", speaker: "Sarah", dialogue: "How long?", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "David", speaker_on_camera: "David", dialogue: null, audio_role: "silent", camera: "Medium close-up of David", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "David", dialogue: "Don't.", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "Sarah", speaker_on_camera: "Sarah", dialogue: null, audio_role: "silent", camera: "Medium close-up of Sarah", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Sarah", dialogue: "Three months, David.", duration_hint_seconds: 3 },
    { type: "broll", function: "insert_evidence", speaker: null, dialogue: null, camera: "insert of the letter, object only", audio_role: "silent", duration_hint_seconds: 3, mouth_visibility_required: false, comic_sting: true, sfx: "stunned" },
    { speaker: "David", dialogue: "That is not mine.", duration_hint_seconds: 3 },
    { type: "reaction", function: "listener_hold", speaker: "David", speaker_on_camera: "Sarah", audio_role: "offscreen", dialogue: "Nora saw who came up.", duration_hint_seconds: 3, mouth_visibility_required: false },
    { speaker: "Sarah", dialogue: "Say the name.", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "David", speaker_on_camera: "David", dialogue: null, audio_role: "silent", camera: "Medium close-up of David", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Nora", dialogue: "I buzzed her at 11.", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "Sarah", speaker_on_camera: "Sarah", dialogue: null, audio_role: "silent", camera: "Medium close-up of Sarah", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Sarah", dialogue: "Eleven, Nora.", duration_hint_seconds: 3 },
    { type: "broll", function: "phone_ui", speaker: null, dialogue: null, camera: "insert of a phone face-down", audio_role: "silent", duration_hint_seconds: 3, mouth_visibility_required: false },
    { speaker: "David", dialogue: "Stop reading that.", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "Sarah", speaker_on_camera: "Sarah", dialogue: null, audio_role: "silent", camera: "Medium close-up of Sarah", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Sarah", dialogue: "Don't say my name.", function: "slap_peak", duration_hint_seconds: 3, hero: true },
    { type: "reaction", function: "reaction", speaker: "David", speaker_on_camera: "David", dialogue: null, audio_role: "silent", camera: "Medium close-up of David", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Nora", dialogue: "The key is still gone.", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "Sarah", speaker_on_camera: "Sarah", dialogue: null, audio_role: "silent", camera: "Medium close-up of Sarah", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { speaker: "Sarah", dialogue: "Whose key, Nora?", duration_hint_seconds: 3 },
    { type: "reaction", function: "reaction", speaker: "David", speaker_on_camera: "David", dialogue: null, audio_role: "silent", camera: "Medium close-up of David", duration_hint_seconds: 2, mouth_visibility_required: false, silence_license: "post_nuke" },
    { function: "button_cu", type: "hero", speaker: "Sarah", dialogue: "Who is she?", duration_hint_seconds: 3 },
  ];
  return lines.map((row) => shot(row));
}

describe("hook and button", () => {
  it("does not accept a flat opening line as a hook, and repair pulls the first live line forward", () => {
    const ten = handbookShots();
    ten[0] = shot({ function: "hook_cu", duration_hint_seconds: 3, dialogue: "Good morning, how was the flight from Geneva." });
    const flat = validateEpisodePlan({ plan: plan(ten), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(flat.blocking.map((row) => row.id)).toContain("HOOK_3S");
    const repaired = repairEpisodePlan({ plan: plan(ten), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const opener = repaired.scenes[0]!.shots[0]!;
    expect(opener.function).toBe("hook_cu");
    expect(opener.dialogue && /[?!]/.test(opener.dialogue) || /\b(don'?t|three months)\b/i.test(opener.dialogue ?? "")).toBe(true);
    const after = validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const thinAfter = repaired.scenes.flatMap((scene) => scene.shots).filter((row, index, all) => index < all.length - 1 && cueRows(row.scene_script).length < 5);
    if (thinAfter.length) expect(after.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(after.pass).toBe(true);
  });

  it("gives a button that gains a line a face camera, and never treats a spoken line as an insert", () => {
    const ten = handbookShots();
    ten[ten.length - 1] = shot({
      function: "insert_evidence",
      type: "broll",
      dialogue: null,
      speaker: null,
      audio_role: "silent",
      camera: "insert of unlabeled paper on dark stone, handwritten block letters TUESDAY only, object only, no people, no faces",
      duration_hint_seconds: 4,
    });
    const repaired = repairEpisodePlan({ plan: plan(ten), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const button = repaired.scenes.at(-1)!.shots.at(-1)!;
    expect(button.function).toBe("button_cu");
    expect(button.dialogue).toBeTruthy();
    expect(button.camera).toMatch(/two-shot|same room|face/i);
    expect(button.camera).not.toMatch(/object only/i);
    expect(isObjectInsert(button)).toBe(false);
    expect(isObjectInsert({ function: "button_cu", dialogue: "Then whose name is on it?", audio_role: "onscreen", camera: "insert of unlabeled paper, object only, no faces" })).toBe(false);
  });

  it("warns when neither the button line nor the cliffhanger leaves a question", () => {
    const ten = tenShotPlan();
    ten[ten.length - 1] = shot({ function: "button_cu", type: "hero", dialogue: "I am going home now.", duration_hint_seconds: 6 });
    const result = validateEpisodePlan({
      plan: plan(ten, { cliffhanger: "She walks out." }),
      namedCast: CAST3,
      length: "60_90",
      episodeNumber: 1,
    });
    expect(result.warnings.map((row) => row.id)).toContain("BUTTON_QUESTION");
    const asked = validateEpisodePlan({ plan: plan(legalSceneTakeShots()), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(asked.warnings.map((row) => row.id)).not.toContain("BUTTON_QUESTION");
  });
});

describe("continuity", () => {
  it("keeps each regrouped scene on the location it was planned in", () => {
    const ten = tenShotPlan();
    const twoLocations: EpisodePlan = {
      ...plan(ten),
      scenes: [
        { location: "penthouse kitchen", time: "night", characters: ["Sarah", "David"], shots: ten.slice(0, 5) },
        { location: "estate lobby", time: "dawn", characters: ["Sarah", "David"], shots: ten.slice(5) },
      ],
    };
    const repaired = repairEpisodePlan({ plan: twoLocations, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const locations = new Set(repaired.scenes.map((scene) => scene.location));
    expect([...locations]).toEqual(["penthouse kitchen"]);
  });

  it("warns on a location or light change that opens without an insert or jump-in", () => {
    const ten = handbookShots();
    const jump: EpisodePlan = {
      ...plan(ten),
      scenes: [
        { location: "penthouse kitchen", time: "night", characters: ["Sarah", "David"], shots: ten.slice(0, 10) },
        { location: "estate lobby", time: "dawn", characters: ["Sarah", "David"], shots: ten.slice(10) },
      ],
    };
    const dead = jump.scenes[1]!.shots[0]!;
    dead.dialogue = "Good morning, how was the flight from Geneva.";
    dead.function = "accusation_cu";
    dead.type = "dialogue";
    dead.camera = "close-up on Sarah";
    dead.speaker = "Sarah";
    dead.speaker_on_camera = "Sarah";
    dead.audio_role = "onscreen";
    const result = validateEpisodePlan({ plan: jump, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(result.warnings.map((row) => row.id)).toEqual(expect.arrayContaining(["CONTINUITY_JUMP", "LIGHT_JUMP"]));

    const bridged: EpisodePlan = {
      ...jump,
      scenes: [
        jump.scenes[0]!,
        { ...jump.scenes[1]!, shots: [ten[5]!, ...ten.slice(10)] },
      ],
    };
    const ok = validateEpisodePlan({ plan: bridged, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(ok.warnings.map((row) => row.id)).not.toContain("CONTINUITY_JUMP");
    expect(ok.warnings.map((row) => row.id)).not.toContain("LIGHT_JUMP");
  });
});

describe("assertPlan.shotBudget", () => {
  it("throws on chopped singles and passes a repaired 4–6 scene-take plan", () => {
    const namedCast = CAST3;
    expect(() =>
      assertDramaPlan({ plan: plan(tenShotPlan()), namedCast, length: "60_90" }),
    ).toThrow(/SHOT_BUDGET|OPERA_PLAN|Drama lint/);
    const repaired = repairEpisodePlan({ plan: plan(tenShotPlan()), namedCast, length: "60_90", episodeNumber: 1 });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);
    expect(shots.every((row) => row.edit_mode === "scene_take")).toBe(true);
    const thin = shots.filter((row, index) => index < shots.length - 1 && cueRows(row.scene_script).length < 5);
    if (thin.length) {
      expect(validateEpisodePlan({ plan: repaired, namedCast, length: "60_90", episodeNumber: 1 }).blocking.map((row) => row.id)).toContain(
        "CUE_COUNT",
      );
    } else {
      expect(assertDramaPlan({ plan: repaired, namedCast, length: "60_90", episodeNumber: 1 }).scenes.length).toBeGreaterThan(0);
    }
  });

  it("blocks two scene takes that speak the same beat", () => {
    const shots = sceneTakeShots();
    shots[1] = {
      ...shots[1]!,
      dialogue: shots[0]!.dialogue,
      scene_script: shots[0]!.scene_script,
    };
    const lint = validateEpisodePlan({ plan: plan(shots), namedCast: CAST3, length: "60_90" });
    expect(lint.blocking.some((row) => row.id === "REPEAT_BEAT")).toBe(true);
  });
});

describe("assertPlan.durationWindow", () => {
  it("throws when hint sum is 40s or 90s for a 60s beat", () => {
    const namedCast = CAST3;
    const short = tenShotPlan().map((row) => ({ ...row, duration_hint_seconds: 4 }));
    expect(() => assertDramaPlan({ plan: plan(short), namedCast })).toThrow(/DURATION_WINDOW|Drama lint/);
    const long = tenShotPlan().map((row) => ({ ...row, duration_hint_seconds: 9 }));
    expect(() => assertDramaPlan({ plan: plan(long), namedCast })).toThrow(/DURATION_WINDOW|OPERA_PLAN|Drama lint/);
  });
});

describe("assertPlan.button", () => {
  it("throws when the last shot is not a button or the cliffhanger is empty", () => {
    const namedCast = CAST3;
    const shots = legalSceneTakeShots();
    shots[shots.length - 1] = shot({ function: "accusation_cu", type: "dialogue", duration_hint_seconds: 15 });
    expect(() => assertDramaPlan({ plan: plan(shots, { cliffhanger: "" }), namedCast })).toThrow(/NO_BUTTON|OPERA_PLAN|SHOT_BUDGET/);
  });
});

describe("assertPlan.hook", () => {
  it("throws when the first shot is not in motion", () => {
    const namedCast = CAST3;
    const shots = legalSceneTakeShots();
    shots[0] = shot({ type: "establishing", function: "accusation_cu", speaker: null, dialogue: null, duration_hint_seconds: 15 });
    expect(() => assertDramaPlan({ plan: plan(shots), namedCast })).toThrow(/HOOK_3S|ILLEGAL_SILENCE|ASL_HOLD|COVERAGE_MIX|OPERA_PLAN|SHOT_BUDGET/);
  });
});

describe("sanitizeCamera.ots", () => {
  it("removes over-the-shoulder language and the partner's body from a single", () => {
    const out = sanitizeCamera("OTS single on Mara from behind Petra's right shoulder: Mara's face fully in frame", { single: true });
    expect(out).not.toMatch(/OTS|shoulder|Petra/);
    expect(out).toMatch(/Mara's face fully in frame/);
    const framed = sanitizeCamera(
      "Tight single on Mara: Mara's face fully in frame, the envelope held at chest height; Petra's silver-streaked chignon and black blazer shoulder occupy the near-left edge as a framing element only",
      { single: true, onCameraName: "Mara", otherNames: ["Mara Voss", "Petra Vane"] },
    );
    expect(framed).not.toMatch(/Petra|chignon|blazer/);
    expect(framed).toMatch(/Mara's face fully in frame/);
    expect(framed).toMatch(/envelope/);
  });
});

describe("sanitizeCamera", () => {
  it("strips Cut to and keeps the locked-take clause", () => {
    const out = sanitizeCamera("Cut to tight reaction");
    expect(out.toLowerCase()).not.toMatch(/cut\s+to/);
    expect(out).toMatch(/single continuous take/i);
  });
});

describe("shot-budget", () => {
  it("splits a 20-word line", () => {
    const shots = splitLongShots(
      [
        shot({
          dialogue: "You knew about this for three months and you still sat at my table every night like nothing happened at all",
          duration_hint_seconds: 16,
        }),
      ],
      LENGTH_BUDGETS["60_90"],
    );
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.every((row) => (row.dialogue ?? "").split(/\s+/).length <= 12)).toBe(true);
  });

  it("merges through applyShotBudget without inventing opera", () => {
    const next = applyShotBudget(plan(tenShotPlan()), LENGTH_BUDGETS["60_90"]);
    expect(next.scenes[0]!.shots.length).toBeGreaterThanOrEqual(8);
    expect(next.scenes[0]!.shots.length).toBeLessThanOrEqual(28);
  });
});

describe("genre playbooks", () => {
  it("ships the eight commercial playbooks", () => {
    for (const id of [
      "billionaire",
      "werewolf",
      "revenge",
      "hidden_identity",
      "mafia",
      "rebirth",
      "workplace_cinderella",
      "legal_medical",
    ] as const) {
      expect(playbookFor(id).tenBeats).toHaveLength(10);
    }
  });

  it("refuses a violent slap on cn_iaa revenge and keeps EN werewolf", () => {
    expect(skuAllowsTrope("revenge blood slap", "cn_iaa", "violent slap")).toBe(false);
    expect(skuAllowsTrope("werewolf luna alpha", "en_iap", "rejection ceremony")).toBe(true);
  });
});

describe("WER", () => {
  it("passes gonna vs going and fails an unrelated sentence", () => {
    expect(wordErrorRate("I am going to leave.", "I am gonna to leave.")).toBeLessThan(0.15);
    expect(wordErrorRate("You knew about this for three months.", "I never said that.")).toBeGreaterThan(0.25);
  });
});

describe("cutDetect.locked", () => {
  it("rejects a locked take with two scene changes", () => {
    expect(lockedTakeRejected("locked_take", 2)).toBe(true);
    expect(lockedTakeRejected("already_cut", 2)).toBe(false);
  });
});

describe("mix.lcut", () => {
  it("marks listener holds as L-cuts", () => {
    const prev: Shot = {
      id: "a",
      scene_id: "sc",
      position: 1,
      selected_generation_id: null,
      status: "complete",
      shot_data: {
        type: "dialogue",
        speaker: "David",
        dialogue: "Three months.",
        emotion: null,
        delivery: null,
        pace: null,
        camera: "cu",
        mouth_visibility_required: true,
        duration_hint_seconds: 5,
        duration_seconds: 5,
        dialogue_audio_asset_id: "x",
        dialogue_alignment_asset_id: "y",
        hero: false,
        audio_role: "onscreen",
      },
    };
    const next: Shot = {
      ...prev,
      id: "b",
      shot_data: { ...prev.shot_data, audio_role: "offscreen", function: "listener_hold", dialogue: "Stay." },
    };
    expect(pickTransition(prev, next)).toBe("lcut");
    const scenePrev = { ...prev, shot_data: { ...prev.shot_data, edit_mode: "scene_take" as const, scene_script: "Sarah: You knew." } };
    const sceneNext = { ...next, shot_data: { ...next.shot_data, edit_mode: "scene_take" as const, scene_script: "David: Don't.", audio_role: "onscreen" as const } };
    expect(pickTransition(scenePrev, sceneNext)).toBe("fade");
  });
});

describe("repair.sealsBeats", () => {
  it("turns a silent-heavy 15-shot opera into 4–6 scene takes with a button", () => {
    const namedCast = ["Mara", "Eli", "Jules"];
    const opera: EpisodePlan["scenes"][number]["shots"] = [
      shot({ type: "establishing", speaker: null, dialogue: null, duration_hint_seconds: 4, camera: "receipt under a palm" }),
      shot({ type: "broll", speaker: null, dialogue: null, duration_hint_seconds: 5 }),
      shot({ type: "hero", speaker: null, dialogue: null, duration_hint_seconds: 4, hero: true }),
      shot({ type: "establishing", speaker: null, dialogue: null, duration_hint_seconds: 3 }),
      shot({ type: "dialogue", speaker: "Eli", dialogue: "Couldn't sleep either?", duration_hint_seconds: 3 }),
      shot({ type: "reaction", speaker: null, dialogue: null, duration_hint_seconds: 4, camera: "Cut to tight reaction" }),
      shot({ type: "broll", speaker: null, dialogue: null, duration_hint_seconds: 3, camera: "hand lifts off the receipt" }),
      shot({ type: "broll", speaker: null, dialogue: null, duration_hint_seconds: 4 }),
      shot({ type: "reaction", speaker: null, dialogue: null, duration_hint_seconds: 6, hero: true }),
      shot({ type: "reaction", speaker: null, dialogue: null, duration_hint_seconds: 5 }),
      shot({ type: "dialogue", speaker: "Mara", dialogue: "How many Tuesdays.", duration_hint_seconds: 5 }),
      shot({ type: "reaction", speaker: null, dialogue: null, duration_hint_seconds: 6 }),
      shot({ type: "dialogue", speaker: "Eli", dialogue: "Mara —", duration_hint_seconds: 3 }),
      shot({ type: "dialogue", speaker: "Mara", dialogue: "That is not a number.", duration_hint_seconds: 4 }),
      shot({ type: "hero", speaker: null, dialogue: null, duration_hint_seconds: 5, hero: true, camera: "Hold on the receipt" }),
    ];
    const repaired = repairEpisodePlan({
      plan: plan(opera, { cliffhanger: "" }),
      namedCast,
      length: "60_90",
    });
    const lint = validateEpisodePlan({ plan: repaired, namedCast, length: "60_90" });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(repaired.scenes.length).toBeGreaterThan(1);
    expect(repaired.scenes.every((scene) => scene.kind)).toBe(true);
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);
    expect(shots.every((row) => row.edit_mode === "scene_take")).toBe(true);
    expect(shots[0]?.function).toMatch(/hook_cu|accusation_cu/);
    expect(shots.at(-1)?.function).toBe("button_cu");
    expect(repaired.cliffhanger.trim().length).toBeGreaterThan(0);
    const thin = shots.filter((row, index) => index < shots.length - 1 && cueRows(row.scene_script).length < 5);
    if (thin.length) expect(lint.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(lint.pass).toBe(true);
  });

  it("caps a 30-shot ping-pong overflow at 6 scene takes", () => {
    const namedCast = ["Mara", "Eli", "Jules"];
    const bloated = Array.from({ length: 30 }, (_, i) =>
      i === 0
        ? shot({ function: "hook_cu", speaker: "Mara", dialogue: "How many Tuesdays?", duration_hint_seconds: 3 })
        : i === 5
          ? shot({
              type: "broll",
              function: "insert_evidence",
              speaker: null,
              dialogue: null,
              camera: "insert of the letter, object only",
              audio_role: "silent",
              duration_hint_seconds: 3,
              mouth_visibility_required: false,
              comic_sting: true,
              sfx: "stunned",
            })
          : i === 29
            ? shot({ function: "button_cu", type: "hero", speaker: "Eli", dialogue: "Then whose name is on it?", duration_hint_seconds: 3 })
            : i % 2 === 0
              ? shot({ speaker: "Mara", dialogue: `Count ${i}.`, duration_hint_seconds: 3, function: "accusation_cu" })
              : shot({
                  type: "reaction",
                  function: "reaction",
                  speaker: "Eli",
                  speaker_on_camera: "Eli",
                  dialogue: null,
                  audio_role: "silent",
                  camera: "Medium close-up of Eli",
                  duration_hint_seconds: 2,
                  mouth_visibility_required: false,
                  silence_license: "post_nuke",
                }),
    );
    const repaired = repairEpisodePlan({
      plan: plan(bloated, { hook: "How many Tuesdays?", cliffhanger: "Then whose name is on it?" }),
      namedCast,
      length: "60_90",
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);
    expect(shots.every((row) => row.edit_mode === "scene_take")).toBe(true);
    const sum = shots.reduce((acc, row) => acc + row.duration_hint_seconds, 0);
    expect(sum).toBeGreaterThanOrEqual(60);
    expect(sum).toBeLessThanOrEqual(90);
    const lint = validateEpisodePlan({ plan: repaired, namedCast, length: "60_90" });
    expect(lint.blocking.map((row) => row.id)).not.toContain("SHOT_BUDGET");
    expect(lint.blocking.map((row) => row.id)).not.toContain("DURATION_WINDOW");
    const nonButton = shots.filter((_, index) => index < shots.length - 1);
    const thinPacked = nonButton.filter((row) => cueRows(row.scene_script).length < 5);
    if (thinPacked.length) expect(lint.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(nonButton.every((row) => cueRows(row.scene_script).length >= 5)).toBe(true);
  });

  it("does not stamp one scene_script onto every packed take", () => {
    const copied =
      "Sarah: How long?\nDavid: Don't.\nSarah: Three months is a confession.\nNora: I buzzed her at eleven.";
    const coverage = [
      shot({ function: "hook_cu", speaker: "Sarah", dialogue: "How long?", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "David", dialogue: "Don't.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "Sarah", dialogue: "Three months is a confession.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "Nora", dialogue: "I buzzed her at eleven.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "Sarah", dialogue: "Say the name.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "David", dialogue: "That is not mine.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({ speaker: "Sarah", dialogue: "Don't say my name.", scene_script: copied, duration_hint_seconds: 3 }),
      shot({
        function: "button_cu",
        type: "hero",
        speaker: "Sarah",
        dialogue: "Who is she?",
        scene_script: copied,
        duration_hint_seconds: 3,
      }),
    ];
    const repaired = repairEpisodePlan({ plan: plan(coverage), namedCast: CAST3, length: "60_90" });
    const takes = repaired.scenes.flatMap((scene) => scene.shots);
    expect(takes.length).toBeGreaterThanOrEqual(4);
    expect(takes.length).toBeLessThanOrEqual(6);
    expect(takes.every((row) => row.edit_mode === "scene_take")).toBe(true);
    const scripts = takes.map((row) => (row.scene_script ?? "").trim()).filter(Boolean);
    expect(new Set(scripts).size).toBe(scripts.length);
  });

  it("strips a line a take echoes from the take before it, and gives the button to a lead", () => {
    const takes = [
      shot({
        function: "hook_cu",
        edit_mode: "scene_take",
        speaker: "Sarah",
        dialogue: "How long?",
        scene_script:
          "Sarah: How long?\nDavid: Don't.\nSarah: Three months is a confession.\nDavid: Nobody knows I am here.\nSarah: Look at me.\nDavid: The date is on it.",
        duration_hint_seconds: 15,
      }),
      shot({
        edit_mode: "scene_take",
        speaker: "David",
        dialogue: "Nobody knows I am here.",
        scene_script:
          "David: Nobody knows I am here.\nSarah: Your coat costs my whole month.\nDavid: I know what it is to owe.\nSarah: Say the name.\nDavid: Not that.\nSarah: Then who.",
        duration_hint_seconds: 15,
      }),
      shot({
        edit_mode: "scene_take",
        speaker: "Nora",
        dialogue: "I buzzed her at eleven.",
        scene_script:
          "Nora: I buzzed her at eleven.\nSarah: Say the name.\nDavid: The name is not mine.\nNora: He counts boxes for a living.\nSarah: Eleven.\nDavid: Look at the slip.",
        duration_hint_seconds: 15,
      }),
      shot({
        function: "button_cu",
        edit_mode: "scene_take",
        type: "hero",
        speaker: "Nora",
        dialogue: "He counts boxes for a living.",
        scene_script:
          "Nora: He counts boxes for a living.\nDavid: There is nothing to read.\nNora: The rain makes people sentimental.",
        duration_hint_seconds: 15,
        hero: true,
      }),
    ];
    const repaired = repairEpisodePlan({ plan: plan(takes), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const out = repaired.scenes.flatMap((scene) => scene.shots);
    for (let i = 1; i < out.length; i += 1) {
      const said = cueRows(out[i - 1]!.scene_script).map(cueText);
      const echoes = cueRows(out[i]!.scene_script).map(cueText).filter((line) => said.includes(line));
      expect(echoes).toEqual([]);
    }
    const button = out.at(-1)!;
    // The cliffhanger belongs to a lead, and nobody says their own name at themselves.
    const buttonCue = cueRows(button.scene_script).at(-1) ?? "";
    const name = buttonCue.split(":")[0]?.trim() ?? "";
    expect(new RegExp(`\\b${name}\\b`, "i").test(cueText(buttonCue))).toBe(false);
    expect(button.scene_script).toMatch(/Sarah|David/);
    expect(out[1]?.blocking?.start_from).toMatch(/last spoken line/);
    expect(out[1]?.blocking?.start_from).toMatch(/JOIN CUT/);
    expect(out[1]?.blocking?.start_from).not.toMatch(/"/);
  });

  it("splits a scene_script that cannot be spoken in 15s and locks sides and the prop", () => {
    const long = [
      "Sarah: That carrier is not yours.",
      "David: Then whose name is on the collar tag?",
      "Sarah: You already know.",
      "David: Say it.",
      "Sarah: I thought I was hiring a courier.",
      "David: You hired the heiress.",
      "Sarah: Then why is the letter still closed?",
      "David: Because you have not opened it.",
    ].join("\n");
    const repaired = repairEpisodePlan({
      plan: plan([
        shot({
          function: "hook_cu",
          edit_mode: "scene_take",
          speaker: "Sarah",
          dialogue: "That carrier is not yours.",
          scene_script: long,
          duration_hint_seconds: 15,
          camera: "medium two-shot, closed carrier on the table",
        }),
        shot({
          function: "scene_take",
          edit_mode: "scene_take",
          speaker: "David",
          dialogue: "Look at me.",
          scene_script: "David: Look at me.\nSarah: I am.",
          duration_hint_seconds: 15,
        }),
        shot({
          function: "scene_take",
          edit_mode: "scene_take",
          speaker: "Nora",
          dialogue: "I buzzed her at eleven.",
          scene_script: "Nora: I buzzed her at eleven.\nSarah: Say the name.",
          duration_hint_seconds: 15,
        }),
        shot({
          function: "button_cu",
          edit_mode: "scene_take",
          type: "hero",
          speaker: "Sarah",
          dialogue: "Who is she?",
          scene_script: "Sarah: Who is she?",
          duration_hint_seconds: 15,
          hero: true,
        }),
      ]),
      namedCast: CAST3,
      length: "60_90",
    });
    const takes = repaired.scenes.flatMap((scene) => scene.shots);
    expect(takes.length).toBeGreaterThanOrEqual(4);
    expect(takes.length).toBeLessThanOrEqual(6);
    expect(takes.every((row) => spokenSeconds(cueRows(row.scene_script)) <= 15.25)).toBe(true);
    expect(takes[0]?.blocking?.camera_left).toBeTruthy();
    expect(takes[0]?.blocking?.camera_right).toBeTruthy();
    expect(takes[0]?.blocking?.prop).toMatch(/carrier|letter|object/);
    expect(takes.every((row) => row.blocking?.camera_left === takes[0]?.blocking?.camera_left)).toBe(true);
    expect(takes.every((row) => row.blocking?.camera_right === takes[0]?.blocking?.camera_right)).toBe(true);
    const coverages = new Set(takes.map((row) => row.blocking?.coverage).filter(Boolean));
    expect(coverages.has("two_shot")).toBe(true);
    expect([...coverages].every((row) => row === "two_shot" || row === "single" || row === "room" || row === "cu")).toBe(true);
    expect(coverages.size).toBeGreaterThan(1);
    const lint = validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90" });
    expect(lint.blocking.map((row) => row.id)).not.toContain("SPEECH_WINDOW");
    const repairedAgain = repairEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90" });
    expect(validateEpisodePlan({ plan: repairedAgain, namedCast: CAST3, length: "60_90" }).blocking.map((row) => row.id)).not.toContain(
      "SPEECH_WINDOW",
    );
  });
});

describe("assertPlan.buttonNovelty", () => {
  it("rejects a button that repeats the hook line", () => {
    const shots = legalSceneTakeShots();
    shots[shots.length - 1] = shot({
      function: "button_cu",
      type: "hero",
      edit_mode: "scene_take",
      dialogue: "How long has this been going on?",
      scene_script: "Sarah: How long has this been going on?",
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated paper on the table",
    });
    expect(() =>
      assertDramaPlan({
        plan: plan(shots, { hook: "How long has this been going on?" }),
        namedCast: CAST3,
      }),
    ).toThrow(/WEAK_BUTTON|OPERA_PLAN|SHOT_BUDGET/);
  });
});

describe("assertPlan.castSize", () => {
  it("rejects a two-name roster", () => {
    expect(() => assertDramaPlan({ plan: plan(legalSceneTakeShots()), namedCast: ["Sarah", "David"] })).toThrow(
      /CAST_BLOAT|INVENTED_SPEAKER/,
    );
  });
});

describe("one-face prompt", () => {
  it("forbids a second person on locked singles and forbids people on inserts", async () => {
    const { dramaHooks } = await import("../integration/hooks.ts");
    const { lockedTakePrompt } = await import("../craft/prompt-fragments.ts");
    const single = lockedTakePrompt({
      location: "penthouse kitchen",
      camera: "close-up",
      onCameraName: "Mara",
      peopleCount: 1,
      objectInsert: false,
      allowTwoShot: false,
    });
    expect(single).toMatch(/ONE face/i);
    expect(single).toMatch(/FORBIDDEN: second person/i);
    const empty = lockedTakePrompt({
      location: "penthouse kitchen",
      camera: "establishing wide of the kitchen",
      shotFunction: "establishing",
      allowTwoShot: false,
      objectInsert: false,
    });
    expect(empty).toMatch(/EMPTY ROOM|NO people/i);
    expect(empty).toMatch(/no bodies|NO bodies/i);
    expect(empty).not.toMatch(/People small or none/);
    expect(empty).not.toMatch(/Extra character sheets only/);
    expect(single).toMatch(/talking two-shot/i);
    expect(single).not.toMatch(/only 2 people/i);
    const insert = lockedTakePrompt({
      camera: "crumpled receipt on marble",
      objectInsert: true,
    });
    expect(insert).toMatch(/NO people/i);
    expect(insert).not.toMatch(/only 2 people/i);
    const shot = {
      id: "s",
      scene_id: "c",
      position: 1,
      selected_generation_id: null,
      status: "planned" as const,
      shot_data: {
        type: "dialogue" as const,
        speaker: "Sarah",
        dialogue: "You knew.",
        emotion: null,
        delivery: null,
        pace: null,
        camera: "close-up",
        mouth_visibility_required: true,
        duration_hint_seconds: 5,
        duration_seconds: 5,
        dialogue_audio_asset_id: null,
        dialogue_alignment_asset_id: null,
        hero: false,
        audio_role: "onscreen" as const,
        function: "accusation_cu" as const,
        speaker_on_camera: "Sarah",
      },
    };
    const { identityLockLine } = await import("../craft/prompt-fragments.ts");
    const sceneTake = dramaHooks.buildVideoPrompt({
      location: "kitchen",
      shot: { ...shot, position: 1, shot_data: { ...shot.shot_data, edit_mode: "scene_take", scene_script: "Sarah: You knew.\nDavid: Don't." } },
      partner: "Nora",
      otherNames: ["Nora", "Petra"],
      identityLocks: [identityLockLine("David")],
    });
    expect(sceneTake).toMatch(/IDENTITY LOCK/);
    expect(sceneTake).toMatch(/Keep David's locked adult face/);
    expect(sceneTake).not.toMatch(/David:\s/);
    expect(sceneTake).toMatch(/frontal stills/);
    expect(sceneTake).toMatch(/Sarah and David/);
    expect(sceneTake).not.toMatch(/Nora|Petra/);
    expect(sceneTake).not.toMatch(/@Video1|Continue the blocking/i);
    expect(sceneTake).toMatch(/SCREEN DIRECTION LOCK/);
    expect(sceneTake).toMatch(/HANDOFF/);
    expect(sceneTake).not.toMatch(/\bactor\b/i);
    expect(sceneTake).not.toMatch(/JOIN CUT/);
    const laterTake = dramaHooks.buildVideoPrompt({
      location: "kitchen",
      shot: { ...shot, position: 1, shot_data: { ...shot.shot_data, edit_mode: "scene_take", scene_script: "Sarah: You knew.\nDavid: Don't." } },
      takeIndex: 2,
    });
    expect(laterTake).toMatch(/JOIN CUT/);
    const built = dramaHooks.buildVideoPrompt({ location: "kitchen", shot, partner: "David", peopleCount: 6 });
    expect(built).not.toMatch(/only 6 people|only 2 people/i);
    expect(built).toMatch(/ONE face only: Sarah/);
    expect(built).toMatch(/FORBIDDEN: OTS, over-the-shoulder/);
    expect(built).not.toMatch(/Medium close-up or OTS/);
    expect(built).toMatch(/do not change face/);
    expect(built).toMatch(/Lighting lock:.*kitchen/i);
    expect(single).toMatch(/Same person as @Image1/);
    const { objectPlateCamera } = await import("../craft/prompt-fragments.ts");
    expect(objectPlateCamera("phone_ui", "Tight single on Jules's face")).toMatch(/no people/i);
    expect(objectPlateCamera("phone_ui", "Tight single on Jules's face")).toMatch(/handwritten/i);
    expect(objectPlateCamera("phone_ui", "Tight single on Jules's face")).not.toMatch(/Jules|41A|11:40/);
    const phone = dramaHooks.buildVideoPrompt({
      location: "lobby",
      shot: {
        ...shot,
        shot_data: {
          ...shot.shot_data,
          type: "dialogue",
          speaker: "Jules",
          dialogue: "Forty-one A.",
          camera: "Tight single on Jules's face",
          function: "phone_ui",
          audio_role: "offscreen",
          speaker_on_camera: "Jules",
          mouth_visibility_required: false,
        },
      },
      partner: "Mara",
      peopleCount: 1,
    });
    expect(phone).toMatch(/NO people|OBJECT INSERT/i);
    expect(phone).not.toMatch(/ONE face only: Jules/);
  });

  it("warns when an insert camera still describes a face", () => {
    const shots = handbookShots();
    shots[13] = shot({
      function: "phone_ui",
      type: "broll",
      speaker: "Nora",
      dialogue: null,
      camera: "Tight single on Nora's face",
      mouth_visibility_required: false,
      duration_hint_seconds: 3,
      audio_role: "silent",
    });
    const result = validateEpisodePlan({
      plan: plan(shots),
      namedCast: CAST3,
      length: "60_90",
    });
    expect(result.warnings.some((row) => row.id === "FACE_ON_INSERT")).toBe(true);
  });
});

describe("recap and ledger", () => {
  it("never prefixes a recap on a 60_90 handbook episode", () => {
    const repaired = repairEpisodePlan({
      plan: plan(tenShotPlan()),
      namedCast: CAST3,
      length: "60_90",
      episodeNumber: 2,
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(shots.some((row) => row.recap)).toBe(false);
    expect(shots[0]?.function).toBe("hook_cu");
    expect(shots[0]?.dialogue).toBeTruthy();
    const lint = validateEpisodePlan({
      plan: repaired,
      namedCast: CAST3,
      length: "60_90",
      episodeNumber: 2,
      hookLedgerCloses: 1,
      hookLedgerOpens: 1,
    });
    const thin = shots.filter((row, index) => index < shots.length - 1 && cueRows(row.scene_script).length < 5);
    if (thin.length) expect(lint.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(lint.pass).toBe(true);
  });

  it("does not prefix recap on E1", () => {
    const repaired = repairEpisodePlan({
      plan: plan(tenShotPlan()),
      namedCast: CAST3,
      episodeNumber: 1,
    });
    expect(repaired.scenes.flatMap((scene) => scene.shots).some((row) => row.recap)).toBe(false);
  });
});

describe("length.wire", () => {
  it("plans 30_45 as an 8–12 shot ad cut / ~38s", () => {
    const budget = LENGTH_BUDGETS["30_45"];
    expect(budget.min_shots).toBe(8);
    expect(budget.max_shots).toBe(12);
    expect(budget.target_episode_seconds).toBe(38);
  });

  it("repairs 60_90 into the 60–90s duration window", () => {
    const repaired = repairEpisodePlan({
      plan: plan(tenShotPlan()),
      namedCast: CAST3,
      length: "60_90",
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    const sum = shots.reduce((acc, row) => acc + row.duration_hint_seconds, 0);
    expect(sum).toBeGreaterThanOrEqual(LENGTH_BUDGETS["60_90"].duration_sum_min);
    expect(sum).toBeLessThanOrEqual(LENGTH_BUDGETS["60_90"].duration_sum_max);
    const lint = validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90" });
    const thin = shots.filter((row, index) => index < shots.length - 1 && cueRows(row.scene_script).length < 5);
    if (thin.length) expect(lint.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(lint.pass).toBe(true);
  });
});

describe("duplicate button", () => {
  it("repairs two button_cu shots down to one last-shot button", () => {
    const doubled = tenShotPlan();
    doubled[doubled.length - 2] = shot({
      function: "button_cu",
      type: "hero",
      dialogue: "I already know the shape of it.",
    });
    doubled[doubled.length - 1] = shot({
      function: "button_cu",
      type: "hero",
      dialogue: "Then whose name is on it?",
    });
    const repaired = repairEpisodePlan({
      plan: plan(doubled),
      namedCast: CAST3,
      length: "60_90",
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    const buttons = shots.filter((row) => row.function === "button_cu");
    expect(buttons).toHaveLength(1);
    expect(shots.at(-1)?.function).toBe("button_cu");
    expect(shots.at(-2)?.function).not.toBe("button_cu");
  });

  it("blocks a plan that still has two buttons", () => {
    const doubled = tenShotPlan();
    doubled[doubled.length - 2] = shot({
      function: "button_cu",
      dialogue: "I already know the shape of it.",
    });
    const lint = validateEpisodePlan({
      plan: plan(doubled),
      namedCast: CAST3,
      length: "60_90",
    });
    expect(lint.blocking.some((row) => row.id === "DUPLICATE_BUTTON")).toBe(true);
  });
});

describe("handbook.60_90", () => {
  it("inverts OPERA_PLAN so a 10-shot talking-head chapter is a block", () => {
    const result = validateEpisodePlan({ plan: plan(tenShotPlan()), namedCast: CAST3, length: "60_90" });
    expect(result.blocking.map((row) => row.id)).toEqual(expect.arrayContaining(["OPERA_PLAN"]));
  });

  it("blocks adjacent same-character same-framing", () => {
    const shots = handbookShots();
    shots[2] = shot({ speaker: "David", dialogue: "Wait.", duration_hint_seconds: 3, function: "accusation_cu" });
    shots[3] = shot({ speaker: "David", dialogue: "Listen.", duration_hint_seconds: 3, function: "accusation_cu" });
    const result = validateEpisodePlan({ plan: plan(shots), namedCast: CAST3, length: "60_90" });
    expect(result.blocking.map((row) => row.id)).toContain("ADJACENT_SAME_FACE");
  });

  it("does not treat an estate-kitchen CU as an establishing wide", () => {
    const shots = handbookShots();
    shots[2] = shot({
      speaker: "David",
      dialogue: "Don't.",
      camera: "Tight single on David's face in the estate kitchen, eyes off lens",
      function: "accusation_cu",
      duration_hint_seconds: 3,
    });
    const result = validateEpisodePlan({ plan: plan(shots), namedCast: CAST3, length: "60_90" });
    expect(result.blocking.map((row) => row.id)).not.toContain("COVERAGE_MIX");
  });

  it("blocks an establishing wide on 60_90", () => {
    const shots = handbookShots();
    shots[4] = shot({
      type: "establishing",
      function: "establishing",
      speaker: null,
      dialogue: null,
      camera: "establishing wide of the penthouse kitchen",
      audio_role: "silent",
      duration_hint_seconds: 3,
      mouth_visibility_required: false,
    });
    const result = validateEpisodePlan({ plan: plan(shots), namedCast: CAST3, length: "60_90" });
    expect(result.blocking.map((row) => row.id)).toEqual(expect.arrayContaining(["COVERAGE_MIX"]));
  });

  it("repairs an 11-shot establishing plan up to the handbook shot budget", () => {
    const sparse = [
      shot({ type: "broll", function: "hook_cu", dialogue: null, camera: "Wide of the full kitchen", duration_hint_seconds: 4 }),
      shot({ type: "establishing", function: "establishing", dialogue: null, camera: "establishing wide of estate kitchen", duration_hint_seconds: 4 }),
      shot({ speaker: "Sarah", dialogue: "How long has this been going on?", duration_hint_seconds: 7 }),
      shot({ speaker: "David", dialogue: "Sarah, please.", duration_hint_seconds: 7 }),
      shot({ speaker: "Sarah", dialogue: "Three months is a confession.", duration_hint_seconds: 7 }),
      shot({ speaker: "David", dialogue: "That is not what you think.", duration_hint_seconds: 7 }),
      shot({ speaker: "Sarah", dialogue: "Then explain it.", duration_hint_seconds: 7 }),
      shot({ type: "reaction", function: "listener_hold", speaker: "David", speaker_on_camera: "Sarah", dialogue: "Nora saw who came up.", audio_role: "offscreen", duration_hint_seconds: 6 }),
      shot({ speaker: "Sarah", dialogue: "Say the name.", duration_hint_seconds: 7 }),
      shot({ speaker: "Nora", dialogue: "I buzzed her at eleven.", duration_hint_seconds: 7 }),
      shot({ function: "button_cu", speaker: "Sarah", dialogue: "Who is she?", duration_hint_seconds: 7 }),
    ];
    const repaired = repairEpisodePlan({ plan: plan(sparse), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(shots.length).toBeGreaterThanOrEqual(4);
    expect(shots.length).toBeLessThanOrEqual(6);
    expect(shots.every((row) => row.edit_mode === "scene_take")).toBe(true);
    expect(shots.some((row) => row.type === "establishing" || row.function === "establishing")).toBe(false);
    expect(shots[0]?.dialogue).toBeTruthy();
    const sparseLint = validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const sparseThin = shots.filter((row, index) => index < shots.length - 1 && cueRows(row.scene_script).length < 5);
    if (sparseThin.length) expect(sparseLint.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    else expect(sparseLint.pass).toBe(true);
  });

  it("blocks a refusal loop and lawyer English", () => {
    const looped = legalSceneTakeShots();
    looped[1] = shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "Sarah",
      dialogue: "Don't take me to the hospital.",
      scene_script: [
        "Sarah: Don't take me to the hospital.",
        "David: I have to take you.",
        "Sarah: No, don't.",
        "David: There are reasons I cannot go.",
        "Sarah: Do not bring me.",
      ].join("\n"),
      duration_hint_seconds: 15,
      camera: "medium two-shot, Sarah and David in the kitchen",
    });
    const blocked = validateEpisodePlan({ plan: plan(looped), namedCast: CAST3, length: "60_90" });
    expect(blocked.blocking.map((row) => row.id)).toContain("STAGED_TALK");
    const staged = legalSceneTakeShots();
    staged[1] = shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "David",
      dialogue: "It is not something that I can do.",
      scene_script: [
        "David: It is not something that I can do.",
        "Sarah: Then say it.",
        "David: That is not how this works.",
        "Sarah: Do not lie.",
        "David: I will not.",
      ].join("\n"),
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated receipt on marble",
    });
    const lawyer = validateEpisodePlan({ plan: plan(staged), namedCast: CAST3, length: "60_90" });
    expect(lawyer.blocking.map((row) => row.id)).toContain("STAGED_TALK");
  });

  it("blocks a non-button take under 5 cues and an average bible face", () => {
    const thin = validateEpisodePlan({ plan: plan(sceneTakeShots()), namedCast: CAST3, length: "60_90" });
    expect(thin.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    const legal = validateEpisodePlan({ plan: plan(legalSceneTakeShots()), namedCast: CAST3, length: "60_90" });
    expect(legal.blocking.map((row) => row.id)).not.toContain("CUE_COUNT");
    const mute = sceneTakeShots();
    mute[1] = shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "David",
      dialogue: "Three months.",
      scene_script: "",
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated receipt on marble",
    });
    const blocked = validateEpisodePlan({ plan: plan(mute), namedCast: CAST3, length: "60_90" });
    expect(blocked.blocking.map((row) => row.id)).toContain("CUE_COUNT");
    const look = validateEpisodePlan({
      plan: plan(sceneTakeShots()),
      namedCast: CAST3,
      length: "60_90",
      bible: {
        title: "You Knew",
        logline: "When will he say the name?",
        characters: [
          {
            name: "Sarah",
            description: "Engine",
            appearance: {
              age_look: "28",
              ethnicity_notes: "",
              hair: "",
              face: "average tired face",
              body: "",
              default_wardrobe: "",
            },
            personality: {},
            relationships: {},
            voice_design_prompt: "",
          },
        ],
        locations: ["penthouse kitchen"],
        episode_structure: [],
        visual_style: {},
        rules: {
          narration_mode: "on",
          dialogue_first: true,
          require_conflict_or_progression: true,
          require_reactions: true,
          require_episode_hook: true,
          require_cliffhanger: true,
          target_episode_seconds: 90,
          min_shots: 4,
          max_shots: 6,
          min_shot_s: 12,
          max_shot_s: 15,
          max_dialogue_s: 15,
        },
      },
    });
    expect(look.blocking.map((row) => row.id)).toContain("CAST_LOOK");
    const wordy = legalSceneTakeShots();
    wordy[1] = shot({
      function: "scene_take",
      edit_mode: "scene_take",
      speaker: "David",
      dialogue: "You're telling me this now after three months of lying to my face about her.",
      scene_script: [
        "David: You're telling me this now after three months of lying to my face about her.",
        "Sarah: Then say it.",
        "David: I can't.",
        "Sarah: You will.",
        "David: Not tonight.",
      ].join("\n"),
      duration_hint_seconds: 15,
      camera: "medium two-shot, dated receipt on marble",
    });
    const wordyLint = validateEpisodePlan({ plan: plan(wordy), namedCast: CAST3, length: "60_90" });
    expect(wordyLint.blocking.map((row) => row.id)).toContain("ON_THE_NOSE");
    const looped = validateEpisodePlan({
      plan: plan(legalSceneTakeShots()),
      namedCast: CAST3,
      length: "60_90",
      episodeNumber: 1,
    });
    expect(looped.warnings.map((row) => row.id)).not.toContain("LOOP_REANCHOR");
    const solo = legalSceneTakeShots();
    solo[0] = shot({
      function: "hook_cu",
      edit_mode: "scene_take",
      speaker: "Sarah",
      dialogue: "How long?",
      scene_script: fiveCueScript("Sarah", "Sarah", "How long?", "Look at me."),
      duration_hint_seconds: 15,
      camera: "medium two-shot, Sarah in the kitchen, dated paper on the table",
    });
    const lonely = validateEpisodePlan({ plan: plan(solo), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(lonely.warnings.map((row) => row.id)).toContain("LOOP_REANCHOR");
    expect(LINT_RULES.find((row) => row.id === "STAGED_TALK")?.severity).toBe("block");
    expect(LINT_RULES.find((row) => row.id === "CUE_COUNT")?.severity).toBe("block");
    expect(LINT_RULES.find((row) => row.id === "CAST_LOOK")?.severity).toBe("block");
    expect(LINT_RULES.find((row) => row.id === "ON_THE_NOSE")?.severity).toBe("block");
  });
});

describe("prompt fragments", () => {
  it("asks for full-length scene takes and UAE-safe pictures", async () => {
    const { systemDramaRules } = await import("../craft/prompt-fragments.ts");
    const system = systemDramaRules("60_90");
    expect(system).not.toMatch(/12 to 25/);
    expect(system).not.toMatch(/prefer fewer longer talking-head/);
    expect(system).toMatch(/CONTINUOUS SCENE TAKES/i);
    expect(system).toMatch(/DECENCY/);
    expect(system).toMatch(/Clothes stay on/);
    expect(system).toMatch(/No drugs/);
    expect(system).toMatch(/CAST LOOK/);
    expect(system).toMatch(/FACE DISTANCE/);
    expect(system).toMatch(/FaceTime-close/);
    expect(system).toMatch(/strikingly beautiful/);
    expect(system).not.toMatch(/Names constantly/i);
    const long = systemDramaRules("900_1080");
    expect(long).toMatch(/CAST LOOK/);
    expect(long).toMatch(/FACE DISTANCE/);
    const { writeEpisodeShape } = await import("../craft/prompt-fragments.ts");
    expect(writeEpisodeShape("60_90")).toMatch(/Name someone at most once/);
    expect(writeEpisodeShape("60_90")).not.toMatch(/Names constantly/i);
    const { dramaHooks } = await import("../integration/hooks.ts");
    const prompt = dramaHooks.writeEpisodeUserPrompt({
      bible: {
        title: "The Boss and the Night Courier",
        logline: "When will the family boss admit the night courier holding the closed wolf-dog carrier is the missing heiress?",
        characters: [
          { name: "Rami", description: "", appearance: { age_look: "30", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" }, personality: {}, relationships: {}, voice_design_prompt: "" },
          { name: "Lina", description: "", appearance: { age_look: "28", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" }, personality: {}, relationships: {}, voice_design_prompt: "" },
          { name: "Noor", description: "", appearance: { age_look: "40", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" }, personality: {}, relationships: {}, voice_design_prompt: "" },
        ],
        locations: ["tower lobby"],
        episode_structure: [{ episode_number: 1, title: "The Carrier", hook: "The carrier is in her hands.", conflict: "He knows her face." }],
        visual_style: {},
        rules: { narration_mode: "on", dialogue_first: true, require_conflict_or_progression: true, require_reactions: true, require_episode_hook: true, require_cliffhanger: true, target_episode_seconds: 90, min_shots: 4, max_shots: 6, min_shot_s: 12, max_shot_s: 15, max_dialogue_s: 15 },
      },
      episodeNumber: 1,
      length: "60_90",
    });
    expect(prompt).toMatch(/Night Courier/);
    expect(prompt).toMatch(/closed wolf-dog carrier/);
    expect(prompt).toMatch(/Never import an object, room, or plot from anywhere else/);
    expect(prompt).toMatch(/END HOOK SHAPE for this episode: revelation/);
    expect(prompt).toMatch(/LOOP OPENER/);
    expect(prompt).toMatch(/both leads appear and speak/);
    expect(prompt).not.toMatch(/named out loud/i);
    expect(prompt).toMatch(/Movement: hook/);
    expect(prompt).not.toMatch(/Names constantly/i);
    const mid = dramaHooks.writeEpisodeUserPrompt({
      bible: {
        title: "The Boss and the Night Courier",
        logline: "When will the family boss admit the night courier holding the closed wolf-dog carrier is the missing heiress?",
        characters: [
          { name: "Rami", description: "", appearance: { age_look: "30", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" }, personality: {}, relationships: {}, voice_design_prompt: "" },
          { name: "Lina", description: "", appearance: { age_look: "28", ethnicity_notes: "", hair: "", face: "", body: "", default_wardrobe: "" }, personality: {}, relationships: {}, voice_design_prompt: "" },
        ],
        locations: ["tower lobby"],
        episode_structure: [
          { episode_number: 1, title: "The Carrier", hook: "The carrier is in her hands.", conflict: "He knows her face." },
          { episode_number: 2, title: "The Name", hook: "She will not say it.", conflict: "He already knows." },
        ],
        visual_style: {},
        rules: { narration_mode: "on", dialogue_first: true, require_conflict_or_progression: true, require_reactions: true, require_episode_hook: true, require_cliffhanger: true, target_episode_seconds: 90, min_shots: 4, max_shots: 6, min_shot_s: 12, max_shot_s: 15, max_dialogue_s: 15 },
      },
      episodeNumber: 2,
      length: "60_90",
    });
    expect(mid).toMatch(/Name someone at most once/);
    expect(mid).not.toMatch(/Re-anchor names constantly/i);
    expect(mid).not.toMatch(/Names constantly/i);
    const { framingForFunction, lockedTakePrompt } = await import("../craft/prompt-fragments.ts");
    expect(framingForFunction("hook_cu")).toMatch(/Medium close-up/);
    expect(framingForFunction("hook_cu")).not.toMatch(/Extreme close-up/);
    expect(lockedTakePrompt({ camera: "cu", shotFunction: "accusation_cu", dialogue: "You knew.", partner: "Cole" })).toMatch(
      /never filling the frame/,
    );
    expect(lockedTakePrompt({ camera: "cu", shotFunction: "accusation_cu", dialogue: "You knew.", partner: "Cole" })).toMatch(
      /shared place|share this room|same room|same place/,
    );
  });
});
