import { describe, expect, it } from "vitest";
import { accessFromAppMetadata } from "./access.ts";

describe("accessFromAppMetadata", () => {
  it("allows admins and beta users from app_metadata only", () => {
    expect(accessFromAppMetadata({ role: "admin" }).allowed).toBe(true);
    expect(accessFromAppMetadata({ role: "admin" }).isAdmin).toBe(true);
    expect(accessFromAppMetadata({ beta: true }).allowed).toBe(true);
    expect(accessFromAppMetadata({ role: "user", beta: true }).allowed).toBe(true);
  });

  it("denies ordinary users and ignores user-editable fields", () => {
    expect(accessFromAppMetadata(undefined).allowed).toBe(false);
    expect(accessFromAppMetadata({ role: "user" }).allowed).toBe(false);
    expect(accessFromAppMetadata({ role: "admin", beta: false }).isAdmin).toBe(true);
    expect(accessFromAppMetadata({ role: "Administrator" }).allowed).toBe(false);
  });
});
