/**
 * Checkout repository — SERVER ONLY.
 *
 * `quoteOrder` uses the per-request ANON client (api.quote_order is public and
 * returns no secrets). `placeOrder` uses the SERVICE-ROLE client because
 * api.place_order is REVOKE-d from anon/authenticated — by the time we get here
 * the server fn (checkout.api.ts) has already enforced CSRF + rate limit +
 * (optional) identity, so this is the narrowly-scoped system op that creates the
 * order on the caller's behalf. Errors are re-thrown as CheckoutError carrying a
 * STABLE snake_case code (mapped from the RPC's RAISE EXCEPTION message); raw SQL
 * never reaches the client.
 */
import { createServerSupabaseClient } from "./supabase.server";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  KNOWN_CHECKOUT_ERROR_CODES,
  type QuoteResult,
  type PlaceOrderResult,
  type QuoteLineInput,
  type PlaceLineInput,
  type CheckoutCustomer,
  type PaymentMethod,
} from "@/lib/checkout-shared";
import type { DeliveryZone } from "@/lib/checkout-ui";

export class CheckoutError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CheckoutError";
  }
}

/** Map a Postgres/PostgREST error to a stable code (unknowns → internal_error). */
function throwCheckoutError(error: { message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new CheckoutError(KNOWN_CHECKOUT_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/**
 * Server-authoritative price quote for a cart (public RPC, ANON client).
 * `coupon` (optional) is validated + priced by the RPC — a bad code never throws
 * here; it comes back as `quote.coupon.applied = false` with a reason. `actorId`
 * lets the RPC evaluate per-user / first-order eligibility for a signed-in buyer.
 */
export async function quoteOrder(
  lines: QuoteLineInput[],
  zone: DeliveryZone,
  coupon?: string | null,
  actorId?: string | null,
): Promise<QuoteResult> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb.schema("api").rpc("quote_order", {
    p_lines: lines,
    p_zone: zone,
    p_coupon_code: coupon ?? null,
    p_actor: actorId ?? null,
  });
  if (error) throwCheckoutError(error);
  return data as QuoteResult;
}

export interface PlaceOrderArgs {
  lines: PlaceLineInput[];
  customer: CheckoutCustomer;
  zone: DeliveryZone;
  method: PaymentMethod;
  idempotencyKey: string;
  /** Verified auth user id, or null for a guest checkout. */
  actorId: string | null;
  quoteToken?: string;
  /** Optional coupon code; re-validated + consumed under the coupon row lock. */
  coupon?: string | null;
  /** sha256 hex of the client-held guest token (guest checkout only). */
  guestTokenHash?: string | null;
}

/** Create an order (service-role; api.place_order is REVOKE-d from anon/auth). */
export async function placeOrder(args: PlaceOrderArgs): Promise<PlaceOrderResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("place_order", {
    p_lines: args.lines,
    p_customer: args.customer,
    p_zone: args.zone,
    p_payment_method: args.method,
    p_idempotency_key: args.idempotencyKey,
    p_actor: args.actorId,
    p_quote_token: args.quoteToken ?? null,
    p_coupon_code: args.coupon ?? null,
    p_guest_token_hash: args.guestTokenHash ?? null,
  });
  if (error) throwCheckoutError(error);
  const result = data as PlaceOrderResult;

  // Attach the level-3 thana and the resolved location ids.
  //
  // Written separately rather than threaded through place_order: that function
  // is ~8.7KB of pricing, stock-reservation, coupon and idempotency logic, and
  // rewriting it to carry four more fields would risk the most safety-critical
  // path in the app for a feature that degrades gracefully.
  //
  // Best-effort ON PURPOSE. If this fails the order still stands and courier
  // booking falls back to parsing the address — exactly the behaviour before
  // these columns existed. A location lookup must never cost a sale.
  const c = args.customer as {
    thana?: string;
    districtId?: number;
    thanaId?: number;
    areaId?: number;
  };
  if (c.thana || c.districtId || c.thanaId || c.areaId) {
    try {
      const { error: locError } = await admin.schema("api").rpc("set_order_location", {
        p_order_id: result.order_id,
        p_thana: c.thana ?? null,
        p_district_id: c.districtId ?? null,
        p_thana_id: c.thanaId ?? null,
        p_area_id: c.areaId ?? null,
      });
      if (locError) {
        const { safeServerLog } = await import("./security.server");
        safeServerLog("warn", "set_order_location failed; order stands without ids", {
          orderNo: result.order_no,
          code: locError.code,
          message: locError.message,
        });
      }
    } catch (err) {
      const { safeServerLog } = await import("./security.server");
      safeServerLog("warn", "set_order_location threw; order stands without ids", {
        orderNo: result.order_no,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // Best-effort order-confirmation email. Never blocks or breaks the sale; skipped
  // on an idempotent replay so a retried checkout can't double-send.
  if (!result.replayed) {
    try {
      const { sendOrderReceived } = await import("./notifications.server");
      await sendOrderReceived({ order: result, customer: args.customer, method: args.method });
    } catch {
      /* email is a non-critical enhancement — swallow */
    }
  }

  return result;
}
