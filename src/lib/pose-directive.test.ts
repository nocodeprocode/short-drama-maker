import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Anchoring a pack on its locked front still fixed the drifting identity but
 * made the model copy the anchor's head angle, so the "profile" came back
 * square to camera and the pack no longer held four usable angles.
 */
describe("still pose directives", () => {
  const source = readFileSync(new URL("../engine/ai/images.ts", import.meta.url), "utf8");

  it("names the turn for every face kind", () => {
    for (const kind of ["front", "three_quarter", "profile", "full_body"]) {
      expect(source).toContain(`${kind}:`);
    }
    expect(source).toMatch(/90 degrees/);
    expect(source).toMatch(/45 degrees/);
  });

  it("uses the directive on both the text and the anchored path", () => {
    const calls = source.match(/poseDirective\(input\.kind\)/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(source).not.toMatch(/`Pose \/ framing: \$\{input\.kind\}\.`/);
  });

  it("tells the anchored path that the reference does not fix the head angle", () => {
    expect(source).toMatch(/do NOT fix the head angle/i);
  });

  it("keeps the single visible iris matte on a turned head", () => {
    expect(source).toMatch(/TURNED_EYE_RULE/);
    expect(source).toMatch(/kind === "profile" \|\| kind === "three_quarter"/);
    expect(source).toMatch(/DARKER than the lit skin/);
  });
});
