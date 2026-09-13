import { describe, expect, it } from "vitest";
import * as edge from "../../supabase/functions/_shared/design-slate.ts";
import { GENRE_IDS } from "@/drama-engine/types/genre.ts";
import {
  buildDesignSlate,
  classifyDesignPhrase,
  expandPlaceName,
  propAssetKey,
  propKindFor,
  propsFromArchetype,
  sameDesignThing,
} from "@/engine/design/slate.ts";

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

const PHRASES = [
  "glass office",
  "hospital bill",
  "private office claim",
  "contract insert readable in 2s",
  "dated newspaper labeled LAST LIFE",
  "gun implied off-frame",
  "wake node",
  "ring box",
  "NDA",
  "board",
  "board vote",
];

describe("design slate parity", () => {
  it("agrees with the engine on every playbook slate", () => {
    for (const brief of BRIEFS) {
      expect(edge.buildDesignSlate(brief)).toEqual(buildDesignSlate(brief));
    }
    for (const genre of GENRE_IDS) {
      expect(edge.buildDesignSlate({ genre })).toEqual(buildDesignSlate({ genre }));
    }
  });

  it("agrees on phrase classification and device props", () => {
    for (const phrase of PHRASES) {
      expect(edge.classifyDesignPhrase(phrase)).toEqual(classifyDesignPhrase(phrase));
    }
    for (const archetype of ["hidden heir / leaked NDA", "the clause / the deed", "true-mate mark / kidnapped Luna"]) {
      expect(edge.propsFromArchetype(archetype)).toEqual(propsFromArchetype(archetype));
    }
  });

  it("agrees on which two names are the same thing", () => {
    const pairs: Array<[string, string]> = [
      ["NDA", "leaked NDA"],
      ["car", "carrier"],
      ["gala", "uninvited gala"],
      ["glass office", "private office"],
      ["penthouse", "penthouse living room"],
    ];
    for (const [a, b] of pairs) {
      expect(edge.sameDesignThing(a, b)).toEqual(sameDesignThing(a, b));
    }
  });

  it("agrees on expanding a shorthand place into a room", () => {
    expect(edge.expandPlaceName("board")).toEqual(expandPlaceName("board"));
    expect(expandPlaceName("board")).toBe("boardroom");
  });

  it("agrees on prop asset keys and cached kinds", () => {
    for (const name of ["leaked NDA", "sealed letter", "face-down phone", "jade token", "brass lamp"]) {
      expect(edge.propAssetKey(name)).toEqual(propAssetKey(name));
      expect(edge.propKindFor(name)).toEqual(propKindFor(name));
    }
  });
});
