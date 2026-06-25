/**
 * Customer-facing reviews API (Pass 3b). Distinct from reviews-admin.api.ts
 * (which is staff moderation). `submitReview` requires an authenticated session
 * — anonymous callers get `requiresAuth` so the UI can prompt sign-in. The review
 * is created as `pending` and never affects the public rating until an admin
 * approves it (Pass 3a moderation queue).
 *
 * Server-only modules are imported INSIDE the handler so they never enter the
 * client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { reviewSubmitSchema } from "@/lib/catalog-admin.schema";

export const submitReview = createServerFn({ method: "POST" })
  .validator(reviewSubmitSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // Must be signed in. (Both customers and staff have a userId.)
    const supabase = createServerSupabaseClient();
    const result = await getAuthenticatedIdentity({ strict: true, client: supabase });
    if (!result.ok) {
      return {
        success: false as const,
        requiresAuth: true as const,
        error: "Please sign in to write a review.",
      };
    }
    const userId = result.identity.userId;

    const rl = await checkIndependentRateLimit("reviewSubmit", {
      ip: getClientIp(),
      account: userId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    try {
      const repo = await import("@/lib/server/reviews-admin.server");
      await repo.submitReview(data, userId);
      return { success: true as const };
    } catch (e) {
      const { ReviewError } = await import("@/lib/server/reviews-admin.server");
      const { reviewErrorMessage } = await import("@/lib/catalog-admin.schema");
      return {
        success: false as const,
        error:
          e instanceof ReviewError
            ? reviewErrorMessage(e.code)
            : "Could not submit your review. Please try again.",
      };
    }
  });
