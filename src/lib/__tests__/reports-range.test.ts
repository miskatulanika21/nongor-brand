import { describe, it, expect } from "vitest";
import {
  reportRangeSchema,
  reportErrorMessage,
  REPORT_ERROR_MESSAGES,
  presetRange,
} from "@/lib/reports-shared";

/**
 * The report range is the one piece of user input on the Reports page — it
 * arrives from the URL (validateSearch), so it is attacker-reachable and worth
 * pinning down here rather than relying on the server's re-validation alone.
 */
describe("reportRangeSchema", () => {
  it("accepts a well-formed range", () => {
    expect(reportRangeSchema.safeParse({ from: "2026-07-10", to: "2026-07-17" }).success).toBe(
      true,
    );
  });

  it("accepts every preset the UI can produce", () => {
    for (const days of [7, 30, 90, 365]) {
      expect(reportRangeSchema.safeParse(presetRange(days)).success).toBe(true);
    }
  });

  it.each([
    ["not a date", "yesterday"],
    ["US ordering", "07-10-2026"],
    ["missing zero padding", "2026-7-10"],
    ["a timestamp", "2026-07-10T00:00:00Z"],
    ["empty", ""],
  ])("rejects %s", (_label, from) => {
    expect(reportRangeSchema.safeParse({ from, to: "2026-07-17" }).success).toBe(false);
  });

  it("rejects an end before the start", () => {
    const r = reportRangeSchema.safeParse({ from: "2026-07-17", to: "2026-07-10" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/after the start/i);
  });

  it("rejects a zero-length range (to === from)", () => {
    // `to` is exclusive, so an equal pair selects nothing at all.
    expect(reportRangeSchema.safeParse({ from: "2026-07-10", to: "2026-07-10" }).success).toBe(
      false,
    );
  });

  it("caps the range at 400 days", () => {
    expect(reportRangeSchema.safeParse({ from: "2025-07-10", to: "2026-07-10" }).success).toBe(
      true,
    ); // 365
    const r = reportRangeSchema.safeParse({ from: "2025-01-01", to: "2026-07-10" }); // ~555
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/400 days/);
  });

  it("allows exactly 400 days but not 401", () => {
    const from = new Date("2026-07-17T00:00:00Z");
    const at = (days: number) =>
      new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    expect(reportRangeSchema.safeParse({ from: "2026-07-17", to: at(400) }).success).toBe(true);
    expect(reportRangeSchema.safeParse({ from: "2026-07-17", to: at(401) }).success).toBe(false);
  });
});

describe("reportErrorMessage", () => {
  it("maps every known RPC error code to its copy", () => {
    for (const code of Object.keys(REPORT_ERROR_MESSAGES)) {
      expect(reportErrorMessage(code)).toBe(REPORT_ERROR_MESSAGES[code]);
    }
  });

  it("falls back to the generic message for unknown or absent codes", () => {
    const generic = REPORT_ERROR_MESSAGES.internal_error;
    expect(reportErrorMessage("some_new_code_from_the_db")).toBe(generic);
    expect(reportErrorMessage(null)).toBe(generic);
    expect(reportErrorMessage(undefined)).toBe(generic);
    expect(reportErrorMessage("")).toBe(generic);
  });

  it("never leaks a raw error code to the operator", () => {
    expect(reportErrorMessage("pgrst_42501_permission_denied")).not.toMatch(/pgrst|42501/);
  });
});
