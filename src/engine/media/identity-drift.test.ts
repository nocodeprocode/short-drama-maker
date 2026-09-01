import { describe, expect, it } from "vitest";
import { identityDrifted, rgbDistance } from "./identity-drift.ts";

describe("identity-drift", () => {
  it("treats a navy suit vs a grey henley as drifted", () => {
    const henley: [number, number, number] = [120, 118, 116];
    const navy: [number, number, number] = [28, 36, 72];
    expect(rgbDistance(henley, navy)).toBeGreaterThan(88);
    expect(identityDrifted(henley, navy)).toBe(true);
    expect(identityDrifted(henley, [118, 116, 114])).toBe(false);
  });
});
