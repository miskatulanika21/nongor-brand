/**
 * Payment-evidence API — createServerFn handlers.
 *
 *   - submitPaymentEvidenceFn → customer/guest submit (CSRF + rate-limit +
 *     owner/guest scope). Decodes the screenshot, uploads it to the private
 *     bucket via the service role, then calls api.submit_payment_evidence (which
 *     re-checks scope + status). Replaces the checkout-time localStorage stash.
 *   - getEvidenceUrlFn → admin signed-URL view of a screenshot (orders.view; the
 *     path must belong to the named order, so one order can't reach another's
 *     evidence).
 *
 * Server-only modules are imported INSIDE the handlers so they never enter the
 * client bundle (pattern: checkout.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { submitEvidenceSchema, evidenceUrlSchema } from "@/lib/evidence-shared";

async function failure(e: unknown) {
  const { EvidenceError } = await import("@/lib/server/evidence.server");
  const { evidenceErrorMessage } = await import("@/lib/evidence-shared");
  const code = e instanceof EvidenceError ? e.code : undefined;
  return { success: false as const, error: evidenceErrorMessage(code), code };
}

export const submitPaymentEvidenceFn = createServerFn({ method: "POST" })
  .validator(submitEvidenceSchema)
  .handler(async ({ data }) => {
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
    const { checkIndependentRateLimit, rateLimitMessage } =
      await import("@/lib/server/rate-limit.server");
    const { MAX_EVIDENCE_BYTES } = await import("@/lib/evidence-shared");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }

    // Optional identity — guest orders are allowed. A verified user becomes the
    // scope; otherwise the raw guest token (in-memory from placement) is hashed.
    const supabase = createServerSupabaseClient();
    const idn = await getAuthenticatedIdentity({ strict: false, client: supabase });
    const userId = idn.ok ? idn.identity.userId : null;

    const rl = await checkIndependentRateLimit("paymentEvidence", {
      ip: getClientIp(),
      account: userId,
    });
    if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

    const repo = await import("@/lib/server/evidence.server");

    let scope: string;
    if (userId) scope = userId;
    else if (data.guestToken) scope = repo.guestScope(data.guestToken);
    else {
      const { evidenceErrorMessage } = await import("@/lib/evidence-shared");
      return {
        success: false as const,
        error: evidenceErrorMessage("no_scope"),
        code: "no_scope" as const,
      };
    }

    try {
      let screenshotPath: string | null = null;
      if (data.screenshot) {
        const bytes = Buffer.from(data.screenshot.base64, "base64");
        if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) {
          throw new repo.EvidenceError("file_too_large");
        }
        screenshotPath = await repo.uploadEvidence(
          data.orderId,
          bytes,
          data.screenshot.contentType,
        );
      }
      const res = await repo.submitEvidence({
        orderId: data.orderId,
        trxId: data.trxId,
        senderNumber: data.senderNumber ?? null,
        scope,
        screenshotPath,
      });
      return {
        success: true as const,
        status: res.status,
        duplicateWarning: res.duplicateWarning,
      };
    } catch (e) {
      return failure(e);
    }
  });

export const getEvidenceUrlFn = createServerFn({ method: "POST" })
  .validator(evidenceUrlSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
    const { checkCsrfOrigin } = await import("@/lib/server/security.server");
    const { requirePermission } = await import("@/lib/server/rbac.server");

    const env = getPublicSupabaseEnv();
    if (!checkCsrfOrigin(env.siteUrl)) {
      return { success: false as const, error: "Invalid request origin." };
    }
    const authz = await requirePermission("orders.view");
    if (!authz.ok) return { success: false as const, error: "Not authorized." };

    // The screenshot must live under this order's prefix — never let one order's
    // detail mint a URL into another order's evidence (or outside the order tree).
    if (!data.path.startsWith(`${data.orderId}/`)) {
      return { success: false as const, error: "Invalid screenshot reference." };
    }

    const { signEvidence } = await import("@/lib/server/evidence.server");
    const url = await signEvidence(data.path, 60);
    if (!url) return { success: false as const, error: "Could not load the screenshot." };
    return { success: true as const, url };
  });
