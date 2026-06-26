/**
 * F-13 — resolveStaffEmails folds per-id Auth lookups into a map + a `degraded`
 * flag. The old listStaff used a single listUsers() (50/page) so staff past the
 * first page silently lost their email and any Auth error was swallowed; the new
 * path resolves each staff id individually and reports partial failures.
 */
import { describe, it, expect } from "vitest";
import { resolveStaffEmails, type StaffEmailLookup } from "@/lib/staff.api";

describe("resolveStaffEmails", () => {
  it("maps successful lookups and is not degraded when all succeed", () => {
    const lookups: StaffEmailLookup[] = [
      { userId: "a", email: "a@x.com", ok: true },
      { userId: "b", email: "b@x.com", ok: true },
    ];
    const { emailById, degraded } = resolveStaffEmails(lookups);
    expect(degraded).toBe(false);
    expect(emailById.get("a")).toBe("a@x.com");
    expect(emailById.get("b")).toBe("b@x.com");
  });

  it("nulls a failed lookup and flags degraded", () => {
    const lookups: StaffEmailLookup[] = [
      { userId: "a", email: "a@x.com", ok: true },
      { userId: "b", email: null, ok: false },
    ];
    const { emailById, degraded } = resolveStaffEmails(lookups);
    expect(degraded).toBe(true);
    expect(emailById.get("a")).toBe("a@x.com");
    expect(emailById.get("b")).toBeNull();
  });

  it("treats a userless success (ok=false) as a null email", () => {
    const { emailById, degraded } = resolveStaffEmails([{ userId: "c", email: null, ok: false }]);
    expect(degraded).toBe(true);
    expect(emailById.get("c")).toBeNull();
  });

  it("returns an empty, non-degraded result for no staff", () => {
    const { emailById, degraded } = resolveStaffEmails([]);
    expect(degraded).toBe(false);
    expect(emailById.size).toBe(0);
  });
});
