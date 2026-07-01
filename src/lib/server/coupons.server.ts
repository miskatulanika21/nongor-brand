/**
 * Admin coupons repository — SERVER ONLY.
 *
 * All calls use the SERVICE-ROLE client because the api.*_coupon RPCs are
 * REVOKE-d from anon/authenticated; the server fn (coupons.api.ts) has already
 * enforced CSRF + `coupons.manage` + MFA step-up + rate limit via
 * guardAdminWrite. The RPCs re-check active-staff and write the canonical audit.
 * Errors are re-thrown as CouponAdminError with a STABLE code; raw SQL never
 * reaches the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  KNOWN_COUPON_ADMIN_ERROR_CODES,
  type AdminCoupon,
  type CouponInput,
} from "@/lib/coupons-shared";

export class CouponAdminError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CouponAdminError";
  }
}

function throwCouponError(error: { code?: string; message?: string }): never {
  const raw = (error.message ?? "").trim();
  // A CHECK/NOT-NULL violation means values were out of bounds for the type.
  if (error.code === "23514" || error.code === "23502") {
    throw new CouponAdminError("invalid_coupon_config");
  }
  throw new CouponAdminError(KNOWN_COUPON_ADMIN_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/** All coupons (active + inactive) for the admin list. */
export async function listCoupons(actorId: string): Promise<AdminCoupon[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_coupons", { p_actor: actorId });
  if (error) throwCouponError(error);
  return (data ?? []) as AdminCoupon[];
}

/** Create or edit a coupon (keyed on code). Returns the row + whether new. */
export async function upsertCoupon(
  input: CouponInput,
  actorId: string,
): Promise<{ coupon: AdminCoupon; created: boolean }> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("upsert_coupon", { p_actor: actorId, p_coupon: input });
  if (error) throwCouponError(error);
  const row = data as { coupon: AdminCoupon; created: boolean };
  return row;
}

/** Enable/disable a coupon. */
export async function setCouponActive(
  code: string,
  active: boolean,
  actorId: string,
): Promise<AdminCoupon> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .schema("api")
    .rpc("set_coupon_active", { p_actor: actorId, p_code: code, p_active: active });
  if (error) throwCouponError(error);
  return data as AdminCoupon;
}

/** Delete a coupon (fails with coupon_in_use if it has been redeemed). */
export async function deleteCoupon(code: string, actorId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .schema("api")
    .rpc("delete_coupon", { p_actor: actorId, p_code: code });
  if (error) throwCouponError(error);
}
