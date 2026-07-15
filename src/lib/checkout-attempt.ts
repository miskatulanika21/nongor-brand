/**
 * Checkout attempt persistence — CLIENT ONLY (guards `window`).
 *
 * A "placement attempt" bundles the idempotency key and the client-held guest
 * tracking token for one logical order. Persisting it in localStorage is what
 * makes retries safe:
 *
 *   • A committed-but-lost-response retry reuses the SAME key, so the server
 *     replays the existing order instead of creating a duplicate (order #2).
 *   • The SAME guest token survives a refresh, so the customer's tracking link
 *     keeps working even if the first success response never arrived.
 *
 * Changing the cart, address, zone, method, or coupon changes the signature and
 * starts a fresh attempt (a genuinely different order). The record is cleared on
 * a definitive success or a cart reset.
 */
import { newIdempotencyKey, newGuestToken } from "@/lib/checkout-shared";

const STORAGE_KEY = "ng.checkout.attempt";

export interface CheckoutAttempt {
  /** Fingerprint of the placement this key + token belong to. */
  signature: string;
  /** Idempotency key reused across retries of the SAME attempt (dedup). */
  idempotencyKey: string;
  /** Client-held raw guest tracking token (a capability; only its hash is sent). */
  guestToken: string;
}

function read(): CheckoutAttempt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (
      p &&
      typeof p.signature === "string" &&
      typeof p.idempotencyKey === "string" &&
      typeof p.guestToken === "string"
    ) {
      return { signature: p.signature, idempotencyKey: p.idempotencyKey, guestToken: p.guestToken };
    }
  } catch {
    /* corrupt/unavailable storage → treat as no attempt */
  }
  return null;
}

function write(a: CheckoutAttempt) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* private mode / quota — proceed with an in-memory-only attempt */
  }
}

/**
 * Return the persisted attempt when it matches this exact placement signature
 * (a retry of the same order → same key + token → the server replays with no
 * duplicate), otherwise mint and persist a fresh one.
 */
export function loadOrCreateAttempt(signature: string): CheckoutAttempt {
  const existing = read();
  if (existing && existing.signature === signature) return existing;
  const fresh: CheckoutAttempt = {
    signature,
    idempotencyKey: newIdempotencyKey(),
    guestToken: newGuestToken(),
  };
  write(fresh);
  return fresh;
}

/** Clear the persisted attempt (after a definitive success or a cart reset). */
export function clearCheckoutAttempt() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
