/**
 * Newsletter API — public opt-in server fn (footer form).
 *
 * CSRF origin + per-IP rate limit, no auth (guests subscribe). The
 * api.subscribe_newsletter RPC is service-role only, so REST can't be spammed
 * directly; it upserts idempotently (re-subscribe refreshes consent).
 *
 * Server-only modules are imported INSIDE the handler so they never enter the
 * client bundle (same pattern as contact.api.ts / reviews.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { newsletterSubscribeSchema } from "@/lib/newsletter-shared";

export const subscribeNewsletterFn = createServerFn({ method: "POST" })
  .validator(newsletterSubscribeSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp, safeServerLog } =
      await import("@/lib/server/security.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkIndependentRateLimit("newsletterSubscribe", { ip: getClientIp() });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { newsletterErrorMessage, NEWSLETTER_ERROR_MESSAGES } =
      await import("@/lib/newsletter-shared");
    const admin = createAdminSupabaseClient();
    const { error } = await admin.schema("api").rpc("subscribe_newsletter", {
      p_email: data.email,
      p_whatsapp: data.whatsapp || null,
    });
    if (error) {
      const raw = (error.message ?? "").trim();
      // Never log the email itself (PII) — only the stable code.
      safeServerLog("warn", "Newsletter subscribe failed", { code: raw || "unknown" });
      return {
        success: false as const,
        error: newsletterErrorMessage(raw in NEWSLETTER_ERROR_MESSAGES ? raw : null),
      };
    }
    return { success: true as const };
  });
