import { describe, expect, it } from "vitest";
import type { EpisodePlan } from "../../engine/domain.ts";
import { sanitizeCamera } from "../editorial/camera-sanitize.ts";
import { applyShotBudget, splitLongShots } from "../editorial/shot-budget.ts";
import { LENGTH_BUDGETS } from "../types/pacing.ts";
import { repairEpisodePlan } from "./repair.ts";
import { assertDramaPlan, validateEpisodePlan } from "./validate-plan.ts";
import { playbookFor } from "../craft/genre-playbooks.ts";
import { skuAllowsTrope } from "../integration/hooks.ts";
import { wordErrorRate } from "../../engine/media/qc.ts";
import { lockedTakeRejected } from "../editorial/cut-detect.ts";
import { pickTransition } from "../editorial/manifest-builder.ts";
import type { Shot } from "../../engine/domain.ts";

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
    shot({ function: "hook_cu", duration_hint_seconds: 7, dialogue: "How long?" }),
    shot({ speaker: "David", dialogue: "Don't.", duration_hint_seconds: 6 }),
    shot({
      type: "reaction",
      function: "listener_hold",
      audio_role: "offscreen",
      speaker: "David",
      speaker_on_camera: "Sarah",
      speakers_off_camera: ["David"],
      dialogue: "Three months is a confession.",
      mouth_visibility_required: false,
      duration_hint_seconds: 6,
    }),
    shot({
      type: "broll",
      function: "insert_evidence",
      speaker: null,
      dialogue: null,
      camera: "insert of the phone with the dated message",
      mouth_visibility_required: false,
      duration_hint_seconds: 5,
      audio_role: "silent",
      comic_sting: true,
      sfx: "stunned",
    }),
    shot({ speaker: "David", dialogue: "Three months.", duration_hint_seconds: 5 }),
    shot({
      type: "establishing",
      function: "stacked_two",
      speaker: null,
      dialogue: null,
      camera: "silent two-shot across the kitchen island, faces small, mouths closed",
      duration_hint_seconds: 4,
      audio_role: "silent",
      mouth_visibility_required: false,
    }),
    shot({ speaker: "David", dialogue: "Sarah, please.", duration_hint_seconds: 6 }),
    shot({ speaker: "Sarah", dialogue: "Don't say my name.", function: "slap_peak", duration_hint_seconds: 6, hero: true }),
    shot({
      type: "establishing",
      function: "establishing",
      speaker: null,
      dialogue: null,
      camera: "establishing wide of the penthouse kitchen, night, same key light",
      duration_hint_seconds: 4,
      audio_role: "silent",
      mouth_visibility_required: false,
    }),
    shot({ function: "button_cu", type: "hero", dialogue: "Who is she?", duration_hint_seconds: 6 }),
  ];
}

describe("hook and button", () => {
  it("does not accept a flat opening line as a hook, and repair pulls the first live line forward", () => {
    const ten = tenShotPlan();
    ten[0] = shot({ function: "hook_cu", duration_hint_seconds: 6, dialogue: "Good morning, how was the flight from Geneva." });
    const flat = validateEpisodePlan({ plan: plan(ten), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(flat.blocking.map((row) => row.id)).toContain("HOOK_3S");
    const repaired = repairEpisodePlan({ plan: plan(ten), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    const opener = repaired.scenes[0]!.shots[0]!;
    expect(opener.function).toBe("hook_cu");
    expect(opener.dialogue && /[?!]/.test(opener.dialogue) || /\b(don'?t|three months)\b/i.test(opener.dialogue ?? "")).toBe(true);
    expect(validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90", episodeNumber: 1 }).pass).toBe(true);
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
    const asked = validateEpisodePlan({ plan: plan(tenShotPlan()), namedCast: CAST3, length: "60_90", episodeNumber: 1 });
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
    expect(locations.has("penthouse kitchen")).toBe(true);
    expect(locations.has("estate lobby")).toBe(true);
    // The button was planned in the lobby; it must not be flattened onto the kitchen.
    const buttonScene = repaired.scenes.find((scene) => scene.shots.some((row) => row.function === "button_cu"));
    expect(buttonScene?.location).toBe("estate lobby");
  });

  it("warns on a location or light change that opens on a face instead of a wide or insert", () => {
    const ten = tenShotPlan();
    const jump: EpisodePlan = {
      ...plan(ten),
      scenes: [
        { location: "penthouse kitchen", time: "night", characters: ["Sarah", "David"], shots: ten.slice(0, 6) },
        // Opens on a dialogue CU in a new place at a new hour.
        { location: "estate lobby", time: "dawn", characters: ["Sarah", "David"], shots: ten.slice(6) },
      ],
    };
    const result = validateEpisodePlan({ plan: jump, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(result.warnings.map((row) => row.id)).toEqual(expect.arrayContaining(["CONTINUITY_JUMP", "LIGHT_JUMP"]));

    const bridged: EpisodePlan = {
      ...jump,
      scenes: [
        jump.scenes[0]!,
        { ...jump.scenes[1]!, shots: [ten[8]!, ...ten.slice(6, 8), ten[9]!] },
      ],
    };
    const ok = validateEpisodePlan({ plan: bridged, namedCast: CAST3, length: "60_90", episodeNumber: 1 });
    expect(ok.warnings.map((row) => row.id)).not.toContain("CONTINUITY_JUMP");
    expect(ok.warnings.map((row) => row.id)).not.toContain("LIGHT_JUMP");
  });
});

describe("assertPlan.shotBudget", () => {
  it("throws on 7 or 13 shots and passes 10", () => {
    const namedCast = CAST3;
    expect(() =>
      assertDramaPlan({ plan: plan(tenShotPlan().slice(0, 7)), namedCast, length: "60_90" }),
    ).toThrow(/SHOT_BUDGET|Drama lint/);
    expect(() =>
      assertDramaPlan({
        plan: plan([...tenShotPlan(), shot(), shot(), shot()]),
        namedCast,
        length: "60_90",
      }),
    ).toThrow(/SHOT_BUDGET|OPERA_PLAN|Drama lint/);
    expect(assertDramaPlan({ plan: plan(tenShotPlan()), namedCast, length: "60_90" }).scenes[0]!.shots).toHaveLength(10);
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
    const shots = tenShotPlan();
    shots[shots.length - 1] = shot({ function: "accusation_cu", type: "dialogue" });
    expect(() => assertDramaPlan({ plan: plan(shots, { cliffhanger: "" }), namedCast })).toThrow(/NO_BUTTON/);
  });
});

describe("assertPlan.hook", () => {
  it("throws when the first shot is not in motion", () => {
    const namedCast = CAST3;
    const shots = tenShotPlan();
    shots[0] = shot({ type: "establishing", function: "accusation_cu", speaker: null, dialogue: null, duration_hint_seconds: 6 });
    expect(() => assertDramaPlan({ plan: plan(shots), namedCast })).toThrow(/HOOK_3S|ILLEGAL_SILENCE|ASL_HOLD/);
  });
});

describe("sanitizeCamera.ots", () => {
  it("removes over-the-shoulder language and the partner's body from a single", () => {
    const out = sanitizeCamera("OTS single on Mara from behind Petra's right shoulder: Mara's face fully in frame", { single: true });
    expect(out).not.toMatch(/OTS|shoulder|Petra/);
    expect(out).toMatch(/Mara's face fully in frame/);
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
    expect(next.scenes[0]!.shots.length).toBeLessThanOrEqual(12);
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
  });
});

describe("repair.sealsBeats", () => {
  it("turns a silent-heavy 15-shot opera into a legal 8–12 beat with a button", () => {
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
    expect(shots.length).toBeGreaterThanOrEqual(8);
    expect(shots.length).toBeLessThanOrEqual(12);
    expect(shots[0]?.function).toMatch(/hook_cu|insert_evidence/);
    expect(shots.at(-1)?.function).toBe("button_cu");
    expect(repaired.cliffhanger.trim().length).toBeGreaterThan(0);
    expect(lint.pass).toBe(true);
  });
});

describe("assertPlan.buttonNovelty", () => {
  it("rejects a button that repeats the hook line", () => {
    const shots = tenShotPlan();
    shots[shots.length - 1] = shot({
      function: "button_cu",
      type: "hero",
      dialogue: "How long has this been going on?",
    });
    expect(() =>
      assertDramaPlan({
        plan: plan(shots, { hook: "How long has this been going on?" }),
        namedCast: CAST3,
      }),
    ).toThrow(/WEAK_BUTTON/);
  });
});

describe("assertPlan.castSize", () => {
  it("rejects a two-name roster", () => {
    expect(() => assertDramaPlan({ plan: plan(tenShotPlan()), namedCast: ["Sarah", "David"] })).toThrow(
      /CAST_BLOAT/,
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
    const built = dramaHooks.buildVideoPrompt({ location: "kitchen", shot, partner: "David", peopleCount: 6 });
    expect(built).not.toMatch(/only 6 people|only 2 people/i);
    expect(built).toMatch(/ONE face only: Sarah/);
    expect(built).toMatch(/FORBIDDEN: OTS, over-the-shoulder/);
    expect(built).not.toMatch(/Medium close-up or OTS/);
    expect(built).toMatch(/do not change face/);
    expect(built).toMatch(/Lighting lock:.*kitchen/i);
    expect(single).toMatch(/Same person as reference image 1/);
    const { objectPlateCamera } = await import("../craft/prompt-fragments.ts");
    expect(objectPlateCamera("phone_ui", "Tight single on Jules's face")).toMatch(/no people/i);
    expect(objectPlateCamera("phone_ui", "Tight single on Jules's face")).toMatch(/TUESDAY|handwritten/i);
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
    const result = validateEpisodePlan({
      plan: plan([
        ...tenShotPlan().slice(0, -1),
        shot({
          function: "phone_ui",
          type: "broll",
          speaker: "Nora",
          dialogue: null,
          camera: "Tight single on Nora's face",
          mouth_visibility_required: false,
          duration_hint_seconds: 5,
          audio_role: "silent",
        }),
        shot({ function: "button_cu", type: "hero", dialogue: "Then whose name is on it?" }),
      ]),
      namedCast: CAST3,
    });
    expect(result.warnings.some((row) => row.id === "FACE_ON_INSERT")).toBe(true);
    expect(result.pass).toBe(true);
  });
});

describe("recap and ledger", () => {
  it("prefixes a ≤4s recap on E2+ without replacing the hook", () => {
    const repaired = repairEpisodePlan({
      plan: plan(tenShotPlan()),
      namedCast: CAST3,
      episodeNumber: 2,
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    expect(shots[0]?.recap).toBe(true);
    expect(shots[0]?.duration_hint_seconds).toBeLessThanOrEqual(4);
    expect(shots.find((row) => !row.recap)?.function).toMatch(/hook_cu|insert_evidence/);
    const lint = validateEpisodePlan({
      plan: repaired,
      namedCast: CAST3,
      episodeNumber: 2,
      hookLedgerCloses: 1,
      hookLedgerOpens: 1,
    });
    expect(lint.pass).toBe(true);
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
  it("plans 30_45 as 6–8 shots / ~38s", () => {
    const budget = LENGTH_BUDGETS["30_45"];
    expect(budget.min_shots).toBe(6);
    expect(budget.max_shots).toBe(8);
    expect(budget.target_episode_seconds).toBe(38);
  });

  it("repairs 60_90 into the 54–66s duration window", () => {
    const repaired = repairEpisodePlan({
      plan: plan(tenShotPlan()),
      namedCast: CAST3,
      length: "60_90",
    });
    const shots = repaired.scenes.flatMap((scene) => scene.shots);
    const sum = shots.reduce((acc, row) => acc + row.duration_hint_seconds, 0);
    expect(sum).toBeGreaterThanOrEqual(LENGTH_BUDGETS["60_90"].duration_sum_min);
    expect(sum).toBeLessThanOrEqual(LENGTH_BUDGETS["60_90"].duration_sum_max);
    expect(validateEpisodePlan({ plan: repaired, namedCast: CAST3, length: "60_90" }).pass).toBe(true);
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

describe("prompt fragments", () => {
  it("never asks for 12–25 second talking heads", async () => {
    const { systemDramaRules } = await import("../craft/prompt-fragments.ts");
    const system = systemDramaRules("60_90");
    expect(system).not.toMatch(/12 to 25/);
    expect(system).not.toMatch(/12–25s/);
    expect(system).not.toMatch(/prefer fewer longer talking-head/);
    expect(system).toMatch(/8–12 locked takes/);
  });
});
