/**
 * Checkout API — createServerFn handlers callable from the storefront.
 *
 *   - quoteOrderFn → server-authoritative price quote (public; anon allowed).
 *   - placeOrderFn → create an order. Optional identity (guest checkout allowed);
 *                    the verified user id becomes p_actor, else null = guest.
 *
 * Both enforce CSRF + rate limit. placeOrderFn additionally re-checks the chosen
 * method against the live public settings (defense-in-depth; the RPC validates
 * the enum but not the operator's enabled set), then delegates to the service-
 * role RPC via the repository. Server-only modules are imported INSIDE the
 * handler closures so they never enter the client bundle (pattern: reviews.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { quoteOrderSchema, placeOrderSchema } from "@/lib/checkout-shared";

async function failure(e: unknown) {
  const { CheckoutError } = await import("@/lib/server/checkout.server");
  const { checkoutErrorMessage } = await import("@/lib/checkout-shared");
  const code = e instanceof CheckoutError ? e.code : undefined;
  return { success: false as const, error: checkoutErrorMessage(code), code };
}

export const quoteOrderFn = createServerFn({ method: "POST" })
  .validator(quoteOrderSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    const rl = await checkIndependentRateLimit("quoteOrder", { ip: getClientIp() });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    // Optional identity so the coupon's per-user / first-order rules are
    // evaluated for a signed-in buyer; a guest quote passes actor = null.
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
    const idn = await getAuthenticatedIdentity({
      strict: false,
      client: createServerSupabaseClient(),
    });
    const actorId = idn.ok ? idn.identity.userId : null;

    try {
      const repo = await import("@/lib/server/checkout.server");
      const quote = await repo.quoteOrder(data.lines, data.zone, data.coupon ?? null, actorId);
      return { success: true as const, quote };
    } catch (e) {
      return failure(e);
    }
  });

export const placeOrderFn = createServerFn({ method: "POST" })
  .validator(placeOrderSchema)
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

    // Optional identity — guest checkout is allowed. A verified user id becomes
    // p_actor (order owned by the account); otherwise null = guest order.
    const supabase = createServerSupabaseClient();
    const idn = await getAuthenticatedIdentity({ strict: false, client: supabase });
    const actorId = idn.ok ? idn.identity.userId : null;

    const rl = await checkIndependentRateLimit("placeOrder", {
      ip: getClientIp(),
      account: actorId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    // Defense-in-depth: the chosen method must be offered by current settings.
    const { fetchPublicSettings } = await import("@/lib/server/settings.server");
    const { availableMethods, checkoutErrorMessage } = await import("@/lib/checkout-shared");
    const { cod, manual } = availableMethods(await fetchPublicSettings());
    const allowed = data.method === "cod" ? cod : manual.includes(data.method);
    if (!allowed) {
      return {
        success: false as const,
        error: checkoutErrorMessage("invalid_payment_method"),
        code: "invalid_payment_method" as const,
      };
    }

    try {
      const repo = await import("@/lib/server/checkout.server");
      const order = await repo.placeOrder({
        lines: data.lines,
        customer: data.customer,
        zone: data.zone,
        method: data.method,
        idempotencyKey: data.idempotencyKey,
        actorId,
        quoteToken: data.quoteToken,
        coupon: data.coupon ?? null,
        guestTokenHash: data.guestTokenHash ?? null,
      });
      return { success: true as const, order };
    } catch (e) {
      return failure(e);
    }
  });
