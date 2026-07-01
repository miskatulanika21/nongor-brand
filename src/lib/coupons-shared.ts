/**
 * Admin coupons — isomorphic types, input schema & error copy shared by the
 * admin UI and the server fns. NO server-only imports (safe in the client
 * bundle). Mirrors the P5d RPCs (api.list_coupons / upsert_coupon /
 * set_coupon_active / delete_coupon) and the P5a `coupons` table.
 *
 * The storefront-facing coupon status lives in checkout-shared.ts (QuoteCoupon);
 * this module is the *admin management* contract only.
 */
import { z } from "zod";

export const COUPON_TYPES = ["percent", "fixed", "free_shipping"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** One coupon row as returned by api.list_coupons / upsert_coupon (snake_case). */
export interface AdminCoupon {
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  min_subtotal: number;
  max_discount: number | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  first_order_only: boolean;
  usage_count: number;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string;
}

// ── Input validation (mirrors the table CHECKs; server re-validates) ─────────

const nullableInt = (min: number) =>
  z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : v),
      z.coerce.number().int().min(min).nullable(),
    )
    .nullable()
    .optional();

const nullableDate = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(40).nullable(),
  )
  .nullable()
  .optional();

/** Validator for saveCoupon (create/edit). Value/type coherence checked below. */
export const couponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Letters, numbers, dash or underscore only."),
    description: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(200).nullable(),
      )
      .nullable()
      .optional(),
    type: z.enum(COUPON_TYPES),
    value: z.coerce.number().int().min(0).max(100000),
    min_subtotal: z.coerce.number().int().min(0).max(10000000),
    max_discount: nullableInt(1),
    usage_limit: nullableInt(1),
    per_user_limit: nullableInt(1),
    first_order_only: z.boolean().default(false),
    starts_at: nullableDate,
    ends_at: nullableDate,
    active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    // Same coherence the DB CHECK (coupons_value_by_type) enforces — surfaced
    // early so the admin gets a field error instead of a generic server reject.
    if (c.type === "percent" && (c.value < 1 || c.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "1–100 for a percentage." });
    }
    if (c.type === "fixed" && c.value < 1) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Must be at least ৳1." });
    }
    if (c.type === "free_shipping" && c.value !== 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Free shipping takes no value." });
    }
  });

export type CouponInput = z.infer<typeof couponInputSchema>;

export const setCouponActiveSchema = z.object({
  code: z.string().trim().min(1).max(40),
  active: z.boolean(),
});

export const couponCodeArgSchema = z.object({
  code: z.string().trim().min(1).max(40),
});

// ── Stable admin error codes → messages ──────────────────────────────────────

export const COUPON_ADMIN_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "You are not authorized to manage coupons.",
  invalid_coupon_code: "Code must be 3–40 chars: letters, numbers, dash or underscore.",
  invalid_coupon_type: "Choose a valid discount type.",
  invalid_coupon_config: "Those coupon values are out of range for the chosen type.",
  coupon_not_found: "That coupon no longer exists.",
  coupon_in_use: "This coupon has already been used — deactivate it instead of deleting.",
};

export const KNOWN_COUPON_ADMIN_ERROR_CODES = new Set(Object.keys(COUPON_ADMIN_ERROR_MESSAGES));

export function couponAdminErrorMessage(code: string | null | undefined): string {
  if (!code) return "Could not complete that coupon action. Please try again.";
  return (
    COUPON_ADMIN_ERROR_MESSAGES[code] ?? "Could not complete that coupon action. Please try again."
  );
}

// ── Display helpers (shared by the admin cards) ──────────────────────────────

/** Short human label for a coupon's discount (e.g. "15% off", "৳200 off"). */
export function couponValueLabel(c: Pick<AdminCoupon, "type" | "value">): string {
  if (c.type === "free_shipping") return "Free delivery";
  if (c.type === "percent") return `${c.value}% off`;
  return `৳${c.value} off`;
}
