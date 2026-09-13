import { describe, expect, it } from "vitest";
import * as edge from "../../supabase/functions/_shared/slate.ts";
import { GENRE_IDS } from "@/drama-engine/types/genre.ts";
import { buildCastSlate, inferGenre, isStoryDevice, JOB_LABELS } from "@/engine/casting/slate.ts";
import { inferGenre as engineInferGenre } from "@/drama-engine/craft/genre-playbooks.ts";

const BRIEFS = [
  { title: "The Signed Contract Wife", idea: "A broke secretary is bound by a contract to a CEO." },
  { title: "Rejected Luna", idea: "An omega is mated to an Alpha who hates her." },
  { title: "You Will Pay", idea: "A ledger of revenge after the wedding." },
  { title: "Secret Baby", idea: "A hidden DNA test and amnesia relabel everyone." },
  { title: "The Don's Debt", idea: "A mafia don claims an innocent courier." },
  { title: "Last Life", idea: "She is reborn with a second chance and a ledger." },
  { title: "Wrong Badge", idea: "An intern and office cleaner is the real owner." },
  { title: "The Clause", idea: "A doctor and lawyer who wrote the hospital clause." },
  { title: "Palace Edict", idea: "A discarded bride in a dynasty palace." },
];

describe("cast slate parity", () => {
  it("agrees with the engine on genre inference and every playbook slate", () => {
    expect(edge.JOB_LABELS).toEqual(JOB_LABELS);
    for (const brief of BRIEFS) {
      const text = `${brief.title} ${brief.idea}`;
      expect(edge.inferGenre(text)).toBe(engineInferGenre(text));
      expect(edge.buildCastSlate(brief)).toEqual(buildCastSlate(brief));
    }
    for (const genre of GENRE_IDS) {
      expect(edge.buildCastSlate({ genre })).toEqual(buildCastSlate({ genre }));
    }
  });

  it("agrees on story-device detection", () => {
    const samples = [
      ["nuke", "test / locket / DNA sheet"],
      ["nuke", "true-mate mark / kidnapped Luna"],
      ["nuke", "hidden heir / leaked NDA"],
      ["nuke", "she’s the owner / she wrote the clause"],
      ["engine", "contract wife / secretary"],
    ] as const;
    for (const [job, role] of samples) {
      expect(edge.isStoryDevice(job, role)).toBe(isStoryDevice(job, role));
    }
  });
});
