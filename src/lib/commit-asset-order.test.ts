import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * An actor's visual_reference_asset_ids is JSONB with no foreign key, so a
 * commit that writes the actor before the asset can leave the pack pointing at
 * a paid still whose row never landed. Three actor stills were orphaned that
 * way: the jobs upsert died on a duplicate idempotency key after the actor row
 * was already written, and the assets upsert at the end never ran.
 */
describe("commitSeriesStore write order", () => {
  const source = readFileSync(new URL("../engine/store-postgres.ts", import.meta.url), "utf8");

  const at = (table: string) => {
    const index = source.indexOf(`client.from("${table}").upsert`);
    expect(index, `${table} upsert not found`).toBeGreaterThan(-1);
    return index;
  };

  it("writes assets before the rows that can still fail", () => {
    const assets = at("assets");
    for (const table of ["characters", "episodes", "generation_jobs", "project_ledger"]) {
      expect(assets, `assets must be written before ${table}`).toBeLessThan(at(table));
    }
  });

  it("writes assets after the rows they reference", () => {
    // assets.series_id -> series and assets.actor_id -> actors.
    expect(at("actors")).toBeLessThan(at("assets"));
  });

  it("upserts assets exactly once", () => {
    const matches = source.match(/client\.from\("assets"\)\.upsert/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
