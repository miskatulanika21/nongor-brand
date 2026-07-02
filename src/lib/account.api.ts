/**
 * Customer-account server fns (Stage 4 P3). The guarded HTTP surface over the
 * account repository (server/account.server.ts → service-role api.* RPCs).
 *
 * Reads: GET + no-store + verified session (own data only — the verified user
 * id is the RPC scope; the client never passes one).
 * Writes: POST + CSRF origin check + verified session + independent per-IP /
 * per-account rate limit (`accountWrite`), mirroring reviews/checkout.
 *
 * Server-only modules are imported INSIDE the handlers so they never enter
 * the client bundle. Every failure returns a safe message from the stable
 * code map (plus the code itself for UI logic); raw errors never escape.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  accountIdSchema,
  addressInputSchema,
  importPayloadSchema,
  measurementInputSchema,
  profilePatchSchema,
  wishlistSyncSchema,
  wishlistToggleSchema,
} from "@/lib/account-shared";

interface GuardOk {
  ok: true;
  userId: string;
}
interface GuardFail {
  ok: false;
  error: string;
  requiresAuth?: true;
}

/** CSRF + verified session + independent rate limit (write path). */
async function guardAccountWrite(
  action: "accountWrite" | "wishlistWrite" = "accountWrite",
): Promise<GuardOk | GuardFail> {
  const { getPublicSupabaseEnv } = await import("@/lib/server/env.server");
  const { checkCsrfOrigin, getClientIp } = await import("@/lib/server/security.server");
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");

  const env = getPublicSupabaseEnv();
  if (!checkCsrfOrigin(env.siteUrl)) {
    return { ok: false, error: "Invalid request origin." };
  }

  const supabase = createServerSupabaseClient();
  const result = await getAuthenticatedIdentity({ strict: true, client: supabase });
  if (!result.ok) {
    return { ok: false, requiresAuth: true, error: "Please sign in to manage your account." };
  }
  const userId = result.identity.userId;

  const rl = await checkIndependentRateLimit(action, {
    ip: getClientIp(),
    account: userId,
  });
  if (!rl.allowed) return { ok: false, error: rateLimitMessage() };

  return { ok: true, userId };
}

function guardFailure(g: GuardFail) {
  return g.requiresAuth
    ? { success: false as const, requiresAuth: true as const, error: g.error }
    : { success: false as const, error: g.error };
}

/** Map a repo failure to the safe envelope (never leaks raw errors). */
async function accountFailure(e: unknown): Promise<{
  success: false;
  error: string;
  code?: string;
}> {
  const { AccountError } = await import("@/lib/server/account.server");
  const { accountErrorMessage } = await import("@/lib/account-shared");
  if (e instanceof AccountError) {
    return { success: false as const, error: accountErrorMessage(e.code), code: e.code };
  }
  return { success: false as const, error: accountErrorMessage(null) };
}

// ── Read ─────────────────────────────────────────────────────────────────────

export const getMyAccountFn = createServerFn({ method: "GET" }).handler(async () => {
  const { setNoStore } = await import("@/lib/server/admin-guard.server");
  await setNoStore();
  const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
  const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
  const { checkIndependentRateLimit, rateLimitMessage } =
    await import("@/lib/server/rate-limit.server");
  const { getClientIp } = await import("@/lib/server/security.server");

  const supabase = createServerSupabaseClient();
  const idn = await getAuthenticatedIdentity({ strict: false, client: supabase });
  if (!idn.ok) {
    return {
      success: false as const,
      requiresAuth: true as const,
      error: "Please sign in to view your account.",
    };
  }

  const rl = await checkIndependentRateLimit("accountRead", {
    ip: getClientIp(),
    account: idn.identity.userId,
  });
  if (!rl.allowed) return { success: false as const, error: rateLimitMessage() };

  try {
    const repo = await import("@/lib/server/account.server");
    const account = await repo.getMyAccount(idn.identity.userId);
    return { success: true as const, account };
  } catch (e) {
    return accountFailure(e);
  }
});

// ── Profile ──────────────────────────────────────────────────────────────────

export const saveProfileFn = createServerFn({ method: "POST" })
  .validator(profilePatchSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const profile = await repo.saveProfile(guard.userId, data);
      return { success: true as const, profile };
    } catch (e) {
      return accountFailure(e);
    }
  });

// ── Addresses ────────────────────────────────────────────────────────────────

export const upsertAddressFn = createServerFn({ method: "POST" })
  .validator(addressInputSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const address = await repo.upsertAddress(guard.userId, data);
      return { success: true as const, address };
    } catch (e) {
      return accountFailure(e);
    }
  });

export const deleteAddressFn = createServerFn({ method: "POST" })
  .validator(accountIdSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      await repo.deleteAddress(guard.userId, data.id);
      return { success: true as const };
    } catch (e) {
      return accountFailure(e);
    }
  });

export const setDefaultAddressFn = createServerFn({ method: "POST" })
  .validator(accountIdSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const address = await repo.setDefaultAddress(guard.userId, data.id);
      return { success: true as const, address };
    } catch (e) {
      return accountFailure(e);
    }
  });

// ── Measurements ─────────────────────────────────────────────────────────────

export const upsertMeasurementFn = createServerFn({ method: "POST" })
  .validator(measurementInputSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const measurement = await repo.upsertMeasurement(guard.userId, data);
      return { success: true as const, measurement };
    } catch (e) {
      return accountFailure(e);
    }
  });

export const deleteMeasurementFn = createServerFn({ method: "POST" })
  .validator(accountIdSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      await repo.deleteMeasurement(guard.userId, data.id);
      return { success: true as const };
    } catch (e) {
      return accountFailure(e);
    }
  });

// ── Wishlist (P6) ────────────────────────────────────────────────────────────
// Both share the dedicated wishlistWrite bucket: hearts are flipped while
// browsing and must never starve profile/address saves (or vice versa).

export const syncWishlistFn = createServerFn({ method: "POST" })
  .validator(wishlistSyncSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite("wishlistWrite");
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const codes = await repo.syncWishlist(guard.userId, data.codes);
      return { success: true as const, codes };
    } catch (e) {
      return accountFailure(e);
    }
  });

export const toggleWishlistFn = createServerFn({ method: "POST" })
  .validator(wishlistToggleSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite("wishlistWrite");
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const result = await repo.toggleWishlist(guard.userId, data.code);
      return { success: true as const, wishlisted: result.wishlisted, codes: result.codes };
    } catch (e) {
      return accountFailure(e);
    }
  });

// ── One-time localStorage import (P4 wires the trigger) ──────────────────────

export const importAccountDataFn = createServerFn({ method: "POST" })
  .validator(importPayloadSchema)
  .handler(async ({ data }) => {
    const guard = await guardAccountWrite();
    if (!guard.ok) return guardFailure(guard);
    try {
      const repo = await import("@/lib/server/account.server");
      const result = await repo.importAccountData(guard.userId, data);
      return { success: true as const, result };
    } catch (e) {
      return accountFailure(e);
    }
  });
