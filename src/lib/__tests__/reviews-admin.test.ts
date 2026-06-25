import { describe, it, expect } from "vitest";
import {
  REVIEW_STATUSES,
  reviewModerateSchema,
  reviewDeleteSchema,
  reviewSubmitSchema,
  reviewErrorMessage,
  REVIEW_ERROR_MESSAGES,
} from "@/lib/catalog-admin.schema";

/**
 * Reviews moderation — TS boundary tests. DB-level guarantees (rating/review_count
 * sync via trigger, stable error codes, grants) are asserted by pass2_db.test.sql.
 */

describe("review schema", () => {
  it("exposes the three statuses", () => {
    expect([...REVIEW_STATUSES]).toEqual(["pending", "approved", "rejected"]);
  });

  it("reviewModerateSchema requires a uuid id + valid status", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(reviewModerateSchema.safeParse({ id: uuid, status: "approved" }).success).toBe(true);
    expect(reviewModerateSchema.safeParse({ id: "not-a-uuid", status: "approved" }).success).toBe(
      false,
    );
    expect(reviewModerateSchema.safeParse({ id: uuid, status: "bogus" }).success).toBe(false);
  });

  it("reviewDeleteSchema requires a uuid id", () => {
    expect(
      reviewDeleteSchema.safeParse({ id: "11111111-1111-1111-1111-111111111111" }).success,
    ).toBe(true);
    expect(reviewDeleteSchema.safeParse({ id: "x" }).success).toBe(false);
  });
});

describe("reviewErrorMessage", () => {
  it("maps known codes to safe messages", () => {
    expect(reviewErrorMessage("review_not_found")).toContain("no longer exists");
    expect(reviewErrorMessage("invalid_status")).toBe("Invalid review status.");
    expect(reviewErrorMessage("actor_not_authorized")).toBe("Not authorized.");
  });

  it("falls back for unknown / nullish codes", () => {
    expect(reviewErrorMessage("whatever")).toContain("try again");
    expect(reviewErrorMessage(undefined)).toContain("unknown error");
    expect(reviewErrorMessage(null)).toContain("unknown error");
  });

  it("never leaks raw SQL for any known code", () => {
    for (const code of Object.keys(REVIEW_ERROR_MESSAGES)) {
      const msg = reviewErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("violates");
    }
  });
});

describe("customer review submission (Pass 3b)", () => {
  const base = { code: "p1", authorName: "Tahmina A.", rating: 5, body: "Lovely fabric." };

  it("accepts a well-formed submission", () => {
    expect(reviewSubmitSchema.safeParse(base).success).toBe(true);
  });

  it("rejects out-of-range rating, empty name/body, oversize body", () => {
    expect(reviewSubmitSchema.safeParse({ ...base, rating: 0 }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ ...base, rating: 6 }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ ...base, authorName: "" }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ ...base, body: "" }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ ...base, body: "x".repeat(2001) }).success).toBe(false);
  });

  it("maps the submission error codes to safe messages", () => {
    expect(reviewErrorMessage("product_not_visible")).toContain("not available");
    expect(reviewErrorMessage("already_reviewed")).toContain("already reviewed");
    expect(reviewErrorMessage("invalid_rating")).toContain("1 to 5");
  });

  it("exposes a submitReview server function", async () => {
    const api = await import("@/lib/reviews.api");
    expect(typeof api.submitReview).toBe("function");
  });

  it("defines a reviewSubmit rate-limit policy", async () => {
    const { RATE_LIMITS } = await import("@/lib/server/rate-limit.server");
    expect(RATE_LIMITS.reviewSubmit).toBeDefined();
    expect(RATE_LIMITS.reviewSubmit.limit).toBeGreaterThan(0);
  });
});

describe("reviews admin API exports", () => {
  it("exposes listReviews / moderateReview / removeReview", async () => {
    const api = await import("@/lib/reviews-admin.api");
    expect(typeof api.listReviews).toBe("function");
    expect(typeof api.moderateReview).toBe("function");
    expect(typeof api.removeReview).toBe("function");
  });

  it("ReviewError carries a code mapped by reviewErrorMessage", async () => {
    const { ReviewError } = await import("@/lib/server/reviews-admin.server");
    const e = new ReviewError("review_not_found");
    expect(e).toBeInstanceOf(Error);
    expect(reviewErrorMessage(e.code)).toContain("no longer exists");
  });
});
