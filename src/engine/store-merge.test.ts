import { describe, expect, it } from "vitest";
import { mergeActorCommit, mergeCharacterCommit } from "./store-postgres.ts";

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

describe("mergeActorCommit", () => {
  it("does not write an old seed over a photo that was just replaced", () => {
    const merged = mergeActorCommit(
      {
        seed_asset_id: "seed-old",
        visual_reference_asset_ids: { front: "still-old" },
        source: "likeness",
        judge_notes: "old pack",
        updated_at: "2026-09-13T12:00:00.000Z",
      },
      {
        seed_asset_id: "seed-new",
        visual_reference_asset_ids: {},
        source: "likeness",
        judge_notes: null,
        updated_at: "2026-09-13T12:05:00.000Z",
      },
    );
    expect(merged.seed_asset_id).toBe("seed-new");
    expect(merged.visual_reference_asset_ids).toEqual({});
    expect(merged.judge_notes).toBeNull();
  });

  it("does not put a deleted still back when the table moved on under the snapshot", () => {
    // A pack was already building when Redo cleared the profile on a second
    // actor. The running task committed its whole loaded store, the deleted
    // still reappeared, and the redo that followed found nothing missing.
    const merged = mergeActorCommit(
      {
        seed_asset_id: null,
        visual_reference_asset_ids: { front: "still-1", profile: "still-old" },
        source: "generated",
        judge_notes: "old pack",
        updated_at: "2026-09-19T20:39:13.000Z",
      },
      {
        seed_asset_id: null,
        visual_reference_asset_ids: { front: "still-1" },
        source: "generated",
        judge_notes: "old pack",
        // Postgres spells an instant differently than the engine does.
        updated_at: "2026-09-19 21:22:04.117+00",
      },
    );
    expect(merged.visual_reference_asset_ids).toEqual({ front: "still-1" });
  });

  it("still writes the stills a task just generated", () => {
    const merged = mergeActorCommit(
      {
        seed_asset_id: null,
        visual_reference_asset_ids: { front: "still-1", profile: "still-new" },
        source: "generated",
        judge_notes: null,
        updated_at: "2026-09-19T21:27:18.000Z",
      },
      {
        seed_asset_id: null,
        visual_reference_asset_ids: { front: "still-1" },
        source: "generated",
        judge_notes: null,
        updated_at: "2026-09-19 21:22:04.117+00",
      },
    );
    expect(merged.visual_reference_asset_ids).toEqual({ front: "still-1", profile: "still-new" });
  });

  it("lets a first generate persist a new seed when the table has none", () => {
    const merged = mergeActorCommit(
      {
        seed_asset_id: "seed-1",
        visual_reference_asset_ids: { front: "still-1" },
        source: "likeness",
        judge_notes: null,
        updated_at: "2026-09-13T12:00:00.000Z",
      },
      {
        seed_asset_id: null,
        visual_reference_asset_ids: {},
        source: "generated",
        updated_at: "2026-09-13T11:00:00.000Z",
      },
    );
    expect(merged.seed_asset_id).toBe("seed-1");
    expect(merged.visual_reference_asset_ids).toEqual({ front: "still-1" });
  });
});
