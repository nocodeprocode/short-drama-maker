import { describe, expect, it } from "vitest";
import { identityLockLine, peopleOnSceneTake, sceneTakeImageLocks, sceneTakePrompt, speakersForSceneTake, speakersFromSceneScript } from "../../drama-engine/craft/prompt-fragments.ts";
import { applySceneTakeStrip, buildSceneTakeRefs, MissingFrontStillError, sheetStrengthFor, strongestStrip } from "./scene-take-refs.ts";

describe("scene-take ref pack", () => {
  it("orders front, side, wardrobe, then the room plate, and never a previous video", () => {
    const pack = buildSceneTakeRefs({
      characters: [
        {
          name: "MARA",
          front: { url: "https://mem/mara-front", id: "mf" },
          profile: { url: "https://mem/mara-side", id: "ms" },
          wardrobe: { url: "https://mem/mara-look", id: "mw" },
        },
        {
          name: "COLE",
          front: { url: "https://mem/cole-front", id: "cf" },
          profile: { url: "https://mem/cole-side", id: "cs" },
        },
      ],
      locationPlate: { url: "https://mem/kitchen", id: "k" },
    });
    expect(pack.images.map((row) => `${row.role}:${row.name}`)).toEqual([
      "front:MARA",
      "profile:MARA",
      "wardrobe:MARA",
      "front:COLE",
      "profile:COLE",
      "room:room",
    ]);
    expect(pack.video).toBeNull();
    expect(pack.labels.some((row) => row.role === "video")).toBe(false);
  });

  it("fails closed when a pictured person has no front still", () => {
    expect(() =>
      buildSceneTakeRefs({
        characters: [{ name: "MARA", profile: { url: "https://mem/side" } }],
      }),
    ).toThrow(MissingFrontStillError);
  });

  it("does not treat a last-frame still as a face", () => {
    const pack = buildSceneTakeRefs({
      characters: [{ name: "MARA", front: { url: "https://mem/mara-front" } }],
      locationPlate: { url: "https://mem/kitchen" },
    });
    expect(pack.images.some((row) => row.role === "front" && row.url.includes("last"))).toBe(false);
    expect(pack.images.find((row) => row.role === "room")?.url).toBe("https://mem/kitchen");
  });

  it("names every still and never a previous take", () => {
    const text = sceneTakeImageLocks([
      { role: "front", name: "MARA" },
      { role: "profile", name: "MARA" },
      { role: "front", name: "COLE" },
      { role: "room", name: "room" },
      { role: "video", name: "previous" },
    ]);
    expect(text).toMatch(/@Image1 is MARA's locked frontal face/);
    expect(text).toMatch(/@Image2 is MARA's locked side face/);
    expect(text).toMatch(/@Image3 is COLE's locked frontal face/);
    expect(text).toMatch(/Only this mouth moves on the brace lines/);
    expect(text).not.toMatch(/script says MARA:/);
    const sided = sceneTakeImageLocks(
      [
        { role: "front", name: "MARA" },
        { role: "front", name: "COLE" },
      ],
      { camera_left: "MARA", camera_right: "COLE" },
    );
    expect(sided).toMatch(/@Image1 is MARA's locked frontal face, camera-left/);
    expect(sided).toMatch(/@Image2 is COLE's locked frontal face, camera-right/);
    expect(sided).toMatch(/MOUTH LOCK/);
    expect(text).toMatch(/@Image4 is the locked empty place plate/);
    expect(text).not.toMatch(/@Video1/);
    expect(text).not.toMatch(/previous take/);
    expect(text).not.toMatch(/last-frame/);
    expect(text).not.toMatch(/\bactor\b/i);
    const weld = sceneTakeImageLocks([
      { role: "front", name: "MARA" },
      { role: "weld", name: "room" },
      { role: "prop", name: "letter" },
    ]);
    expect(weld).toMatch(/@Image2 is the locked end picture of this same room/);
    expect(weld).toMatch(/@Image3 is the locked letter/);
    expect(weld).not.toMatch(/@Video1|previous take|last-frame|Continue the blocking/i);
  });

  it("keeps the locked room plate even when a weld still is present", () => {
    const pack = buildSceneTakeRefs({
      characters: [{ name: "MARA", front: { url: "https://mem/mara-front" } }],
      locationPlate: { url: "https://mem/kitchen", id: "k" },
      weldPlate: { url: "https://mem/end", id: "w" },
      propPlate: { url: "https://mem/letter", id: "p", name: "letter" },
    });
    expect(pack.images.map((row) => row.role)).toEqual(["front", "room", "weld", "prop"]);
    expect(pack.video).toBeNull();
    expect(applySceneTakeStrip(pack, "weld").images.map((row) => row.role)).toEqual(["front", "room", "prop"]);
    expect(applySceneTakeStrip(pack, "location").images.map((row) => row.role)).toEqual(["front", "prop"]);
  });

  it("locks the people who speak, not the first two names on the scene card", () => {
    expect(speakersFromSceneScript("MARA: Put it down.\nCOLE: No.\nPETRA walks out.")).toEqual(["MARA", "COLE"]);
    expect(
      speakersForSceneTake({
        sceneScript: "MARA: Stay.\nCOLE: Felix.\nFELIX: Boss—",
      }),
    ).toEqual(["MARA", "COLE", "FELIX"]);
    expect(
      peopleOnSceneTake({
        sceneScript: "MARA: Stay.\nCOLE: My ride.",
        blocking: { present: ["MARA", "COLE", "FELIX"] },
      }),
    ).toEqual(["MARA", "COLE", "FELIX"]);
    expect(identityLockLine("MARA")).toMatch(/Keep MARA's locked adult face/);
    expect(identityLockLine("MARA")).not.toMatch(/MARA:\s/);
    expect(identityLockLine("MARA")).not.toMatch(/[A-Z]+: same adult/);
    expect(
      speakersForSceneTake({
        sceneScript: "MARA: You signed this the same day.\nCOLE: I know.",
        speaker: "MARA",
        speakerOnCamera: "MARA",
      }),
    ).toEqual(["MARA", "COLE"]);
    const text = sceneTakePrompt({
      location: "kitchen",
      camera: "Medium shot from the waist up",
      people: ["MARA", "PETRA"],
      sceneScript: "MARA: You signed this.\nCOLE: I know.",
    });
    expect(text).toMatch(/MARA and COLE/);
    expect(text).toMatch(/SPEECH/);
    expect(text.indexOf("SPEECH")).toBeLessThan(text.indexOf("SHOT LIST"));
    expect(text.split("Speak only the text inside").length).toBe(2);
    expect(text).toMatch(/\{You signed this\.\}/);
    expect(text).toMatch(/\{I know\.\}/);
    expect(text).toMatch(/Never speak a character name/);
    expect(text).not.toMatch(/A MARA: line/);
    expect(text).not.toMatch(/PETRA/);
    expect(text).not.toMatch(/@Video1|Continue the blocking/i);
    expect(text).toMatch(/SCREEN DIRECTION LOCK/);
    expect(text).toMatch(/do not swap sides/i);
    expect(text).toMatch(/HANDOFF/);
    expect(text).toMatch(/CAST LOOK|FACE DISTANCE|never too far/i);
    expect(text).toMatch(/strikingly beautiful|beautiful people|beautiful face/i);
    expect(text).not.toMatch(/\b(celebrity|actor|actress|undress|nude|naked)\b/i);
    expect(text).toMatch(/Clothes stay on/);
    expect(text).toMatch(/No drugs/);
    expect(text).toMatch(/Do not attach or remake a previous take/);
    expect(text).toMatch(/STAGING/);
    expect(text).toMatch(/PHYSICS/);
    expect(text).not.toMatch(/waist or chest up/);
    expect(text).toMatch(/mid-thigh up/);
    expect(text).not.toMatch(/\bactor\b/i);
    const alley = sceneTakePrompt({
      location: "Service alley — wet brick, rain, caged bulb",
      camera: "Medium two-shot",
      people: ["MARA", "COLE"],
      sceneScript: "MARA: Open your eyes.\nCOLE: No hospital.",
    });
    expect(alley).toMatch(/OUTSIDE|PLACE LOCK/);
    expect(alley).toMatch(/curtains|blinds/);
    expect(alley).not.toMatch(/interior location plate/i);
    const swapped = sceneTakePrompt({
      location: "kitchen",
      camera: "Medium two-shot",
      people: ["COLE", "MARA"],
      sceneScript: "COLE: Then do it.\nMARA: Nobody gives me orders in the rain?\nCOLE: I count money at night.\nCOLE: That is all I am.\nCOLE: The strap is fake.",
      blocking: { camera_left: "MARA", camera_right: "COLE" },
      imageLocks: [
        { role: "front", name: "MARA" },
        { role: "front", name: "COLE" },
      ],
    });
    expect(swapped).toMatch(/ONLY 2 people in this room: MARA and COLE/);
    expect(swapped).toMatch(/@Image1 is MARA's locked frontal face, camera-left/);
    expect(swapped).toMatch(/\{Nobody gives me orders/);
    expect(swapped).not.toMatch(/MARA:\s/);
    expect(swapped).toMatch(/Over-the-shoulder|close-up on the person|Dirty single on the person/i);
    expect(swapped).not.toMatch(/Dirty single on MARA|close-up on MARA/i);
    expect(swapped).not.toMatch(/Cut back to the same|from the same camera position/);
    const joined = sceneTakePrompt({
      location: "Service alley — wet brick, rain, caged bulb",
      camera: "Medium two-shot",
      people: ["MARA", "COLE"],
      sceneScript: "MARA: Open your eyes.\nCOLE: No hospital.\nMARA: Look at me.\nCOLE: I am.",
      takeIndex: 1,
    });
    expect(joined).toMatch(/JOIN CUT/);
    expect(joined).toMatch(/Do not reprint the previous take's last frame/);
    const trio = sceneTakePrompt({
      location: "kitchen",
      camera: "Medium two-shot",
      people: ["MARA", "COLE"],
      sceneScript: "MARA: Stay.\nCOLE: Felix.\nFELIX: Boss—\nMARA: Late.\nCOLE: My ride.",
      identityLocks: [identityLockLine("MARA"), identityLockLine("COLE"), identityLockLine("FELIX")],
    });
    expect(trio).toMatch(/ONLY 3 people/);
    expect(trio).toMatch(/FELIX/);
    expect(trio).not.toMatch(/Do not invent a third person/);
    expect(trio).not.toMatch(/MARA:\s/);
    expect(trio).toMatch(/Keep MARA's locked adult face/);
  });

  it("strips plate then wardrobe then sides, and never drops a front still", () => {
    const pack = buildSceneTakeRefs({
      characters: [
        {
          name: "MARA",
          front: { url: "https://mem/mara-front" },
          profile: { url: "https://mem/mara-side" },
          wardrobe: { url: "https://mem/mara-look" },
        },
      ],
      locationPlate: { url: "https://mem/kitchen" },
    });
    expect(applySceneTakeStrip(pack, "location").images.map((row) => row.role)).toEqual([
      "front",
      "profile",
      "wardrobe",
    ]);
    expect(applySceneTakeStrip(pack, "location").video).toBeNull();
    expect(applySceneTakeStrip(pack, "wardrobe").images.map((row) => row.role)).toEqual(["front", "profile"]);
    expect(applySceneTakeStrip(pack, "sides").images.map((row) => row.role)).toEqual(["front"]);
  });

  it("presses the sheet treatment before it takes any reference away", () => {
    const pack = buildSceneTakeRefs({
      characters: [
        {
          name: "MARA",
          front: { url: "https://mem/mara-front" },
          profile: { url: "https://mem/mara-side" },
          wardrobe: { url: "https://mem/mara-look" },
        },
      ],
      locationPlate: { url: "https://mem/kitchen" },
    });
    for (const rung of ["sheet1", "sheet2", "sheet3"] as const) {
      expect(applySceneTakeStrip(pack, rung).images.map((row) => row.role)).toEqual(["front", "profile", "wardrobe", "room"]);
    }
    expect(sheetStrengthFor("none")).toBe(0);
    expect(sheetStrengthFor("sheet1")).toBe(1);
    expect(sheetStrengthFor("sheet2")).toBe(2);
    // Once the ladder starts removing stills the heaviest treatment stays on.
    expect(sheetStrengthFor("sheet3")).toBe(3);
    expect(sheetStrengthFor("wardrobe")).toBe(3);
    expect(sheetStrengthFor("faces")).toBe(3);
    expect(strongestStrip("sheet2", "sheet1")).toBe("sheet2");
    expect(strongestStrip("sheet3", "location")).toBe("location");
  });

  it("keeps only faces on the last rung, and never steps back down the ladder", () => {
    const pack = buildSceneTakeRefs({
      characters: [
        {
          name: "MARA",
          front: { url: "https://mem/mara" },
          profile: { url: "https://mem/mara-side" },
          wardrobe: { url: "https://mem/mara-look" },
        },
      ],
      locationPlate: { url: "https://mem/kitchen" },
      propPlate: { url: "https://mem/letter", name: "letter" },
    });
    expect(applySceneTakeStrip(pack, "sides").images.map((row) => row.role)).toEqual(["front", "prop"]);
    expect(applySceneTakeStrip(pack, "faces").images.map((row) => row.role)).toEqual(["front"]);
    expect(strongestStrip("wardrobe", "location")).toBe("wardrobe");
    expect(strongestStrip("wardrobe", "faces")).toBe("faces");
    expect(strongestStrip(undefined, "location")).toBe("location");
    expect(strongestStrip("sides", undefined)).toBe("sides");
  });
});
