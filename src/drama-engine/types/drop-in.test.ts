import { describe, expect, it } from "vitest";
import { DROP_IN_RULES, dropInProblems, spokenHasRoleId, unlabeledEntranceHits } from "./drop-in.ts";

const secondEntrance = [
  "OREN: (enters) Boss.",
  "ROMAN: My second.",
  "OREN: They're waiting.",
  "ROMAN: Then stall them.",
  "OREN: How long.",
].join("\n");

const internEntrance = [
  "VANCE: My intern stays.",
  "KIRA: (enters) You wanted the floor.",
  "VANCE: Sign it.",
  "KIRA: Or I walk.",
  "VANCE: Then walk.",
].join("\n");

const nurseEntrance = [
  "ELENA: The night nurse is here.",
  "MIRA: (enters) He spiked again.",
  "ELENA: Keep him here.",
  "MIRA: That's not my call.",
  "ELENA: It is tonight.",
].join("\n");

const sisterLine = "Your sister still gets her surgery?";

describe("DROP_IN_RULES", () => {
  it("is the genre-agnostic ad drop-in law", () => {
    expect(DROP_IN_RULES).toMatch(/DROP-IN/);
    expect(DROP_IN_RULES).toMatch(/TikTok ad/i);
    expect(DROP_IN_RULES).toMatch(/episode 47/);
    expect(DROP_IN_RULES).toMatch(/my second/);
    expect(DROP_IN_RULES).toMatch(/night nurse/);
    expect(DROP_IN_RULES).toMatch(/your sister/);
    expect(DROP_IN_RULES).not.toMatch(/\b(nude|naked|undress|celebrity|cocaine|actor)\b/i);
    expect(DROP_IN_RULES).not.toMatch(/Mara|Cole|wolf|mate-claim/i);
  });
});

describe("spokenHasRoleId", () => {
  it("passes the conservative role phrases and rejects a bare name", () => {
    expect(spokenHasRoleId("My second.")).toBe(true);
    expect(spokenHasRoleId("The night nurse is here.")).toBe(true);
    expect(spokenHasRoleId(sisterLine)).toBe(true);
    expect(spokenHasRoleId("Kira.")).toBe(false);
    expect(spokenHasRoleId("Boss.")).toBe(false);
  });
});

describe("drop-in comprehension", () => {
  it("fails one face talking to a ghost in take 1", () => {
    const hits = dropInProblems({
      takes: [
        {
          script: ["VANCE: You're late.", "VANCE: Sign it.", "VANCE: Or walk."].join("\n"),
          speaker: "Vance",
        },
      ],
    });
    expect(hits.some((row) => row.kind === "solo_opener")).toBe(true);
  });

  it("passes a CEO/intern opener with two people on camera", () => {
    expect(
      dropInProblems({
        takes: [
          {
            script: [
              "VANCE: You're late.",
              "KIRA: You put me on the floor.",
              "VANCE: That's the job.",
              "KIRA: Then say the number.",
              "VANCE: Sign it or walk.",
            ].join("\n"),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("passes a doctor/patient opener with two people on camera", () => {
    expect(
      dropInProblems({
        takes: [
          {
            script: [
              "ELENA: Stay in that bed.",
              "NOAH: You're not my doctor.",
              "ELENA: I am tonight.",
              "NOAH: Then say why.",
              "ELENA: Because you walked.",
            ].join("\n"),
          },
        ],
      }),
    ).toEqual([]);
  });

  it("fails a stranger named on entrance with no role", () => {
    const hits = dropInProblems({
      takes: [
        {
          script: [
            "VANCE: You're late.",
            "KIRA: You put me on the floor.",
            "VANCE: That's the job.",
            "KIRA: Then say the number.",
            "VANCE: Sign it or walk.",
          ].join("\n"),
        },
        {
          script: [
            "KIRA: (enters) You wanted me.",
            "VANCE: Kira.",
            "KIRA: Say it.",
            "VANCE: Sit down.",
            "KIRA: Or I walk.",
          ].join("\n"),
          blocking: { enters: ["Kira"] },
        },
      ],
    });
    expect(hits.some((row) => row.kind === "entrance_unnamed" && row.detail.includes("Kira"))).toBe(true);
  });

  it("passes my second, the night nurse, and your sister on an entrance take", () => {
    expect(unlabeledEntranceHits({ take: { script: secondEntrance }, previousPresent: ["ROMAN"] })).toEqual([]);
    expect(unlabeledEntranceHits({ take: { script: internEntrance }, previousPresent: ["VANCE"] })).toEqual([]);
    expect(unlabeledEntranceHits({ take: { script: nurseEntrance }, previousPresent: ["ELENA"] })).toEqual([]);
    expect(
      unlabeledEntranceHits({
        take: { script: `DAVID: ${sisterLine}\nJUNO: (enters) I'm still here.` },
        previousPresent: ["DAVID"],
      }),
    ).toEqual([]);
    expect(
      dropInProblems({
        takes: [
          {
            script: [
              "ROMAN: You're late.",
              "NYLA: Then look at me.",
              "ROMAN: I did.",
              "NYLA: Say it.",
              "ROMAN: Stay.",
            ].join("\n"),
          },
          { script: secondEntrance, blocking: { enters: ["Oren"] } },
        ],
      }),
    ).toEqual([]);
  });

  it("does not treat an unnamed new speaker as a DROP_IN miss", () => {
    expect(
      unlabeledEntranceHits({
        take: {
          script: [
            "NORA: I buzzed her at eleven.",
            "SARAH: Don't.",
            "NORA: Three months.",
            "SARAH: Say it.",
            "NORA: Say the name.",
          ].join("\n"),
        },
        previousPresent: ["Sarah", "David"],
      }),
    ).toEqual([]);
  });
});
