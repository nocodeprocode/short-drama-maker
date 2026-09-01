import { describe, expect, it } from "vitest";
import type { Shot } from "../domain.ts";
import { dialogueMatchesTranscript, shouldSampleDialogueStt } from "./stt-qc.ts";

function shot(id: string, dialogue: string | null, status: Shot["status"] = "generating"): Shot {
  return {
    id,
    scene_id: "sc",
    position: 1,
    selected_generation_id: null,
    status,
    shot_data: {
      type: dialogue ? "dialogue" : "reaction",
      speaker: dialogue ? "sarah" : null,
      dialogue,
      emotion: null,
      delivery: null,
      pace: null,
      camera: "close_up",
      mouth_visibility_required: Boolean(dialogue),
      duration_hint_seconds: 12,
      duration_seconds: 12,
      dialogue_audio_asset_id: null,
      dialogue_alignment_asset_id: null,
      hero: false,
    },
  };
}

describe("sample STT QC", () => {
  it("samples every on-screen dialogue shot", () => {
    const shots = [
      shot("d1", "One"),
      shot("r1", null),
      shot("d2", "Two"),
      shot("d3", "Three"),
      shot("d4", "Four"),
    ];
    expect(shouldSampleDialogueStt(shots[0]!, shots)).toBe(true);
    expect(shouldSampleDialogueStt(shots[1]!, shots)).toBe(false);
    expect(shouldSampleDialogueStt(shots[2]!, shots)).toBe(true);
    expect(shouldSampleDialogueStt(shots[3]!, shots)).toBe(true);
    expect(shouldSampleDialogueStt(shots[4]!, shots)).toBe(true);
  });

  it("always samples a shot already marked needs_review", () => {
    const review = shot("d2", "Two", "needs_review");
    expect(shouldSampleDialogueStt(review, [shot("d1", "One"), review])).toBe(true);
  });

  it("folds spoken numbers when comparing the line", () => {
    expect(dialogueMatchesTranscript("You knew for 3 months.", "you knew for three months")).toBe(
      true,
    );
    expect(dialogueMatchesTranscript("Leave.", "Stay.")).toBe(false);
  });
});
