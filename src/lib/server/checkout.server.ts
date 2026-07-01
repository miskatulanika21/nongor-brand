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

/** Server-authoritative price quote for a cart (public RPC, ANON client). */
export async function quoteOrder(
  lines: QuoteLineInput[],
  zone: DeliveryZone,
): Promise<QuoteResult> {
  const sb = createServerSupabaseClient();
  const { data, error } = await sb
    .schema("api")
    .rpc("quote_order", { p_lines: lines, p_zone: zone });
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
  });
  if (error) throwCheckoutError(error);
  return data as PlaceOrderResult;
}
