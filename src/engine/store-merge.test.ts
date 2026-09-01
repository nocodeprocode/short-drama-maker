import { describe, expect, it } from "vitest";
import { mergeCharacterCommit } from "./store-postgres.ts";

describe("mergeCharacterCommit", () => {
  it("does not wipe stills when a later job commits a stale snapshot", () => {
    const merged = mergeCharacterCommit(
      {
        id: "c1",
        series_id: "s1",
        name: "Reem Saleh",
        description: "A 31-year-old woman.",
        visual_profile: { visual_reference_asset_ids: {} },
        voice_profile: {
          design_prompt: "soft",
          elevenlabs_voice_id: null,
          canonical_reference_asset_id: null,
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 0,
          locked: false,
        },
        locked: false,
        created_at: "2026-08-30T00:00:00.000Z",
        updated_at: "2026-08-30T00:00:00.000Z",
      },
      {
        visual_profile: { visual_reference_asset_ids: { front: "still-1" } },
        voice_profile: {
          design_prompt: "soft",
          elevenlabs_voice_id: "el_1",
          canonical_reference_asset_id: "voice-1",
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 1,
          locked: true,
        },
        locked: true,
      },
    );
    expect(merged.locked).toBe(true);
    expect((merged.visual_profile as { visual_reference_asset_ids?: { front?: string } }).visual_reference_asset_ids?.front).toBe(
      "still-1",
    );
    expect(merged.voice_profile.elevenlabs_voice_id).toBe("el_1");
  });

  it("does not relock a character that is mid voice-sex repair", () => {
    const merged = mergeCharacterCommit(
      {
        id: "c1",
        series_id: "s1",
        name: "Reem Saleh",
        description: "A 31-year-old woman.",
        visual_profile: { visual_reference_asset_ids: { front: "still-1" } },
        voice_profile: {
          design_prompt: "soft",
          elevenlabs_voice_id: "el_male",
          canonical_reference_asset_id: "voice-1",
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 1,
          locked: true,
        },
        locked: true,
        created_at: "2026-08-30T00:00:00.000Z",
        updated_at: "2026-08-30T00:00:00.000Z",
      },
      {
        visual_profile: { visual_reference_asset_ids: { front: "still-1" } },
        voice_profile: {
          design_prompt: "Adult woman. Female speaking voice. soft",
          elevenlabs_voice_id: null,
          canonical_reference_asset_id: null,
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 1,
          locked: false,
          pending_previews: [],
        },
        locked: false,
      },
    );
    expect(merged.locked).toBe(false);
    expect(merged.voice_profile.elevenlabs_voice_id).toBeNull();
    expect(merged.voice_profile.design_prompt).toMatch(/Adult woman/);
  });

  it("keeps the original created_at so cast order does not jump", () => {
    const merged = mergeCharacterCommit(
      {
        id: "c1",
        series_id: "s1",
        name: "Reem Saleh",
        description: "A 31-year-old woman.",
        visual_profile: {},
        voice_profile: {
          design_prompt: "soft",
          elevenlabs_voice_id: null,
          canonical_reference_asset_id: null,
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 0,
          locked: false,
        },
        locked: false,
        created_at: "2026-08-31T12:00:00.000Z",
        updated_at: "2026-08-31T12:00:00.000Z",
      },
      {
        created_at: "2026-08-30T00:00:00.000Z",
        voice_profile: {
          design_prompt: "soft",
          elevenlabs_voice_id: null,
          canonical_reference_asset_id: null,
          accent: "american",
          age_profile: "31",
          speaking_style: "conversational",
          default_energy: "calm",
          voice_version: 0,
          locked: false,
        },
      },
    );
    expect(merged.created_at).toBe("2026-08-30T00:00:00.000Z");
  });
});
