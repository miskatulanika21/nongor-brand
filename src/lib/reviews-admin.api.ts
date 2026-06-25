/**
 * Reviews admin API — createServerFn handlers for moderation. Reads and writes
 * both require `reviews.manage`; writes additionally flow through guardAdminWrite
 * (CSRF + strict permission + MFA step-up + rate limit + denial audit). The
 * canonical review.* audit is written inside the api.* RPC.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as catalog-admin.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { reviewModerateSchema, reviewDeleteSchema } from "@/lib/catalog-admin.schema";

async function messageFromReviewError(e: unknown): Promise<string> {
  const { ReviewError } = await import("@/lib/server/reviews-admin.server");
  const { reviewErrorMessage } = await import("@/lib/catalog-admin.schema");
  if (e instanceof ReviewError) return reviewErrorMessage(e.code);
  return "Could not complete the change. Please try again.";
}

export const listReviews = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { requirePermission } = await import("@/lib/server/rbac.server");
  const authz = await requirePermission("reviews.manage");
  if (!authz.ok) return { success: false as const, error: "Not authorized.", reviews: [] };
  const { fetchAdminReviews } = await import("@/lib/server/reviews-admin.server");
  try {
    return { success: true as const, reviews: await fetchAdminReviews() };
  } catch {
    return { success: false as const, error: "Could not load reviews.", reviews: [] };
  }
});

export const moderateReview = createServerFn({ method: "POST" })
  .validator(reviewModerateSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("reviews.manage", "moderateReview");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/reviews-admin.server");
    try {
      const res = await repo.setReviewStatus(data.id, data.status, g.actorId);
      return { success: true as const, changed: res.changed };
    } catch (e) {
      return { success: false as const, error: await messageFromReviewError(e) };
    }
  });

export const removeReview = createServerFn({ method: "POST" })
  .validator(reviewDeleteSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("reviews.manage", "removeReview");
    if (!g.ok) return { success: false as const, error: g.error };

    const repo = await import("@/lib/server/reviews-admin.server");
    try {
      await repo.deleteReview(data.id, g.actorId);
      return { success: true as const };
    } catch (e) {
      return { success: false as const, error: await messageFromReviewError(e) };
    }
  });
