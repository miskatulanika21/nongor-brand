/**
 * Contact API — createServerFn handlers.
 *
 * submitContactFn is PUBLIC (guests submit): CSRF origin + per-IP rate limit, no
 * auth. The RPC is service-role only, so it can't be spammed directly over REST.
 * The admin reads/writes are gated: list → messages.view, status → messages.manage.
 *
 * Server-only modules are imported INSIDE handlers so they never enter the client
 * bundle (same pattern as orders.api.ts / reviews.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { contactSubmitSchema, contactListSchema, contactStatusSchema } from "@/lib/contact-shared";

export const submitContactFn = createServerFn({ method: "POST" })
  .validator(contactSubmitSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkIndependentRateLimit("contactSubmit", { ip: getClientIp() });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const { submitContactMessage, ContactError } = await import("@/lib/server/contact.server");
    const { contactErrorMessage } = await import("@/lib/contact-shared");
    try {
      await submitContactMessage({
        name: data.name,
        phone: data.phone,
        message: data.message,
        reason: data.reason,
        email: data.email || undefined,
        orderNumber: data.orderNumber || undefined,
      });
      return { success: true as const };
    } catch (e) {
      return {
        success: false as const,
        error: e instanceof ContactError ? contactErrorMessage(e.code) : contactErrorMessage(null),
      };
    }
  });

export const listContactMessagesFn = createServerFn({ method: "GET" })
  .validator(contactListSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("messages.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized.", rows: [], total: 0 };

    const { listContactMessages } = await import("@/lib/server/contact.server");
    try {
      const res = await listContactMessages({
        actorId: authz.identity.userId,
        status: data.status,
        search: data.search,
        limit: data.limit,
        offset: data.offset,
      });
      return { success: true as const, rows: res.rows, total: res.total };
    } catch {
      return { success: false as const, error: "Could not load messages.", rows: [], total: 0 };
    }
  });

export const setContactMessageStatusFn = createServerFn({ method: "POST" })
  .validator(contactStatusSchema)
  .handler(async ({ data }) => {
    const { guardAdminWrite } = await import("@/lib/server/admin-guard.server");
    const g = await guardAdminWrite("messages.manage", "setContactMessageStatus");
    if (!g.ok) return { success: false as const, error: g.error };

    const { setContactMessageStatus, ContactError } = await import("@/lib/server/contact.server");
    const { contactErrorMessage } = await import("@/lib/contact-shared");
    try {
      await setContactMessageStatus(g.actorId, data.id, data.status);
      return { success: true as const };
    } catch (e) {
      return {
        success: false as const,
        error: e instanceof ContactError ? contactErrorMessage(e.code) : contactErrorMessage(null),
      };
    }
  });
