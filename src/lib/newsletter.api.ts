/**
 * Newsletter API — public double opt-in server fns (footer form + email links).
 *
 * subscribeNewsletterFn: CSRF origin + per-IP rate limit, no auth (guests
 *   subscribe). The api.subscribe_newsletter RPC is service-role only, so REST
 *   can't be spammed directly; it upserts idempotently and returns a status. On a
 *   new/pending subscriber it issues a confirm token that we email (double
 *   opt-in) — the address is only added to the list after the recipient clicks
 *   confirm. An already-confirmed address is a no-op.
 * confirmNewsletterFn / unsubscribeNewsletterFn: token-gated, called from the
 *   /newsletter/confirm and /newsletter/unsubscribe pages (email link clicks).
 *
 * Server-only modules are imported INSIDE each handler so they never enter the
 * client bundle (same pattern as contact.api.ts / reviews.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { newsletterSubscribeSchema } from "@/lib/newsletter-shared";

function tokenValidator(input: unknown): { token: string } {
  const raw =
    input && typeof input === "object" && "token" in input
      ? (input as { token: unknown }).token
      : "";
  return { token: typeof raw === "string" ? raw.slice(0, 128) : "" };
}

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

    const ip = getClientIp();
    const rl = await checkIndependentRateLimit("newsletterSubscribe", { ip });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { newsletterErrorMessage, NEWSLETTER_ERROR_MESSAGES } =
      await import("@/lib/newsletter-shared");
    const admin = createAdminSupabaseClient();
    const { data: res, error } = await admin.schema("api").rpc("subscribe_newsletter", {
      p_email: data.email,
      p_whatsapp: data.whatsapp || null,
      p_source: "footer",
      p_ip: ip,
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

    const status = (res as { status?: string } | null)?.status ?? "pending";
    if (status === "pending") {
      const token = (res as { confirm_token?: string } | null)?.confirm_token;
      if (token) {
        const { sendNewsletterConfirmation } = await import("@/lib/server/newsletter.server");
        // Best-effort: the row is saved; a mail hiccup shouldn't fail the request.
        await sendNewsletterConfirmation(data.email, token);
      }
      return { success: true as const, status: "pending" as const };
    }

    // Already confirmed — idempotent, nothing emailed.
    return { success: true as const, status: "confirmed" as const };
  });

export const confirmNewsletterFn = createServerFn({ method: "POST" })
  .validator(tokenValidator)
  .handler(async ({ data }) => {
    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { safeServerLog } = await import("@/lib/server/security.server");
    const admin = createAdminSupabaseClient();
    const { data: res, error } = await admin
      .schema("api")
      .rpc("confirm_newsletter", { p_token: data.token });
    if (error) {
      safeServerLog("warn", "Newsletter confirm failed", { code: error.code ?? "unknown" });
      return { status: "error" as const };
    }
    const status = (res as { status?: string } | null)?.status ?? "invalid";
    if (status === "confirmed") {
      const email = (res as { email?: string }).email;
      const unsub = (res as { unsubscribe_token?: string }).unsubscribe_token;
      if (email && unsub) {
        const { sendNewsletterWelcome } = await import("@/lib/server/newsletter.server");
        await sendNewsletterWelcome(email, unsub);
      }
    }
    return { status: status as "confirmed" | "already_confirmed" | "invalid" };
  });

export const unsubscribeNewsletterFn = createServerFn({ method: "POST" })
  .validator(tokenValidator)
  .handler(async ({ data }) => {
    const { createAdminSupabaseClient } = await import("@/lib/server/supabase-admin.server");
    const { safeServerLog } = await import("@/lib/server/security.server");
    const admin = createAdminSupabaseClient();
    const { data: res, error } = await admin
      .schema("api")
      .rpc("unsubscribe_newsletter", { p_token: data.token });
    if (error) {
      safeServerLog("warn", "Newsletter unsubscribe failed", { code: error.code ?? "unknown" });
      return { status: "error" as const };
    }
    const status = (res as { status?: string } | null)?.status ?? "invalid";
    return { status: status as "unsubscribed" | "invalid" };
  });
