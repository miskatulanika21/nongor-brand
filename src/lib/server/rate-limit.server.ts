/**
 * Server-side rate limiting for auth-sensitive endpoints.
 *
 * Pluggable store:
 *   - Default: in-memory fixed-window counter (correct within one instance).
 *   - Optional: Upstash Redis REST (shared across instances) when
 *     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are configured.
 *
 * Why an abstraction: the in-memory store is fine for single-instance / dev,
 * but a horizontally-scaled deployment (e.g. Cloudflare Workers isolates)
 * needs a shared store. Setting the two Upstash env vars switches every
 * limiter to the distributed backend with no code change. See README /
 * DEPLOYMENT for setup. (Spec §27.)
 *
 * Auth endpoints use checkIndependentRateLimit() to enforce SEPARATE per-IP
 * and per-account buckets (both must pass) so neither IP rotation nor account
 * rotation can bypass the other's limit. checkRateLimit() remains the lower
 * level primitive (single bucket per identifier set), used directly only for
 * single-dimension limits (e.g. IP-only OAuth start). Messages never reveal the
 * exact threshold. The .server.ts suffix keeps this off the client.
 */
import process from "node:process";
import { safeServerLog } from "./security.server";

// ---- Policy presets ---------------------------------------------------------

export interface RateLimitPolicy {
  /** Max attempts allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export const RATE_LIMITS = {
  /** Password login: protect against credential stuffing. */
  login: { limit: 8, windowSec: 60 * 5 },
  /** Registration: limit automated signup abuse. */
  register: { limit: 5, windowSec: 60 * 10 },
  /** Forgot-password requests. */
  passwordReset: { limit: 5, windowSec: 60 * 15 },
  /** Reset/update submission. */
  passwordUpdate: { limit: 8, windowSec: 60 * 10 },
  /** OAuth initiation. */
  oauthStart: { limit: 15, windowSec: 60 * 5 },
  /** MFA verification attempts. */
  mfaVerify: { limit: 10, windowSec: 60 * 5 },
  /** MFA enrollment initiation — limit factor churn / abuse. */
  mfaEnroll: { limit: 5, windowSec: 60 * 10 },
  /** MFA factor removal — sensitive; the only MFA op previously unguarded. */
  mfaManage: { limit: 10, windowSec: 60 * 10 },
  /** Staff invitation / provisioning. */
  staffProvision: { limit: 10, windowSec: 60 * 10 },
  /** Catalog admin writes (products, categories) — higher volume than auth ops. */
  catalogWrite: { limit: 120, windowSec: 60 * 5 },
  /** Customer review submission — limit spam from a single IP/account. */
  reviewSubmit: { limit: 5, windowSec: 60 * 10 },
  /** Checkout price quote — a cheap public read; generous but not unlimited. */
  quoteOrder: { limit: 60, windowSec: 60 },
  /** Order placement — a write that creates rows; strict per IP + account. */
  placeOrder: { limit: 10, windowSec: 60 * 10 },
  /** Payment-evidence submission (TrxID + screenshot upload) — strict. */
  paymentEvidence: { limit: 8, windowSec: 60 * 10 },
  /** Guest order tracking — a public read keyed by order-no + token; per-IP. */
  trackOrder: { limit: 30, windowSec: 60 * 5 },
  /** Account snapshot read (own data, auth-gated) — generous. */
  accountRead: { limit: 60, windowSec: 60 },
  /** Account writes (profile / addresses / measurements / one-time import). */
  accountWrite: { limit: 30, windowSec: 60 * 10 },
  /**
   * Wishlist sync + heart toggles — cheap idempotent writes fired while
   * browsing, so more generous than accountWrite (and isolated from it: an
   * enthusiastic hearting session never starves address/profile saves).
   */
  wishlistWrite: { limit: 60, windowSec: 60 * 10 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (only meaningful when blocked). */
  retryAfterSec: number;
}

// ---- Store interface --------------------------------------------------------

interface RateLimitStore {
  /** Increment the counter for `key`, returning the new count and ttl. */
  hit(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }>;
}

// ---- In-memory store (default) ----------------------------------------------

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowSec * 1000;
      this.buckets.set(key, { count: 1, resetAt });
      return { count: 1, ttlSec: windowSec };
    }
    existing.count += 1;
    return { count: existing.count, ttlSec: Math.ceil((existing.resetAt - now) / 1000) };
  }

  /** Drop expired buckets occasionally so the map cannot grow unbounded. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}

// ---- Upstash Redis REST store (optional, shared) ----------------------------

class UpstashStore implements RateLimitStore {
  constructor(
    private url: string,
    private token: string,
  ) {}

  async hit(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }> {
    // Pipeline: INCR then (best-effort) EXPIRE on first hit.
    const redisKey = `rl:${key}`;
    const res = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(windowSec), "NX"],
      ]),
    });
    if (!res.ok) throw new Error(`Upstash error ${res.status}`);
    const data = (await res.json()) as Array<{ result: number }>;
    const count = Number(data?.[0]?.result ?? 1);
    return { count, ttlSec: windowSec };
  }
}

// ---- Store selection (lazy, request-time env) -------------------------------

let store: RateLimitStore | undefined;

function getStore(): RateLimitStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    store = new UpstashStore(url, token);
    safeServerLog("info", "Rate limiter: using shared Upstash store");
  } else {
    store = new MemoryStore();
  }
  return store;
}

// ---- Public API -------------------------------------------------------------

/**
 * Record an attempt and report whether it is allowed.
 *
 * Pass one or more identifiers (IP, normalized email, user id). They are
 * combined into the key so limits apply per (action, identifier-set).
 *
 * Fails OPEN on store errors: a rate-limiter outage must not lock everyone
 * out of login. The error is logged for visibility.
 */
export async function checkRateLimit(
  action: RateLimitAction,
  identifiers: Array<string | null | undefined>,
): Promise<RateLimitResult> {
  const policy = RATE_LIMITS[action];
  const id = identifiers
    .filter((x): x is string => !!x)
    .map((x) => x.toLowerCase())
    .join("|");
  const key = `${action}:${id || "anon"}`;

  try {
    const { count, ttlSec } = await getStore().hit(key, policy.windowSec);
    if (count > policy.limit) {
      return { allowed: false, retryAfterSec: ttlSec };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (err) {
    safeServerLog("error", "Rate limiter store failed (failing open)", {
      action,
      error: err instanceof Error ? err.message : "unknown",
    });
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Independent per-IP and per-account rate limiting.
 *
 * Runs two SEPARATE buckets for the same action and requires BOTH to pass:
 *   - per-IP bucket      → key `action:ip:<ip>`      (catches account rotation)
 *   - per-account bucket → key `action:account:<id>` (catches IP rotation)
 *
 * This replaces the weaker single combined `action:ip|account` key, where an
 * attacker rotating IPs got a fresh bucket every request, and rotating accounts
 * likewise. With independent buckets, rotating one dimension cannot exhaust the
 * other's allowance.
 *
 * The account identifier is normalized (trim + lowercase) so casing/whitespace
 * variants share one bucket. Both checks inherit checkRateLimit's fail-open
 * policy (a limiter outage must not lock everyone out of auth).
 *
 * Trusted-proxy note: the IP must come from a source the platform controls
 * (see getClientIp in security.server.ts). A client-spoofable IP would let an
 * attacker mint unlimited per-IP buckets; the per-account bucket is the
 * backstop in that case.
 */
export async function checkIndependentRateLimit(
  action: RateLimitAction,
  parts: { ip?: string | null; account?: string | null },
): Promise<RateLimitResult> {
  const tasks: Array<Promise<RateLimitResult>> = [];

  if (parts.ip) tasks.push(checkRateLimit(action, [`ip:${parts.ip}`]));

  const account = parts.account?.trim().toLowerCase();
  if (account) tasks.push(checkRateLimit(action, [`account:${account}`]));

  // No identifiers at all → one anonymous bucket so the endpoint is never
  // completely unlimited.
  if (tasks.length === 0) tasks.push(checkRateLimit(action, [null]));

  const results = await Promise.all(tasks);
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length > 0) {
    return { allowed: false, retryAfterSec: Math.max(...blocked.map((r) => r.retryAfterSec)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Generic, threshold-free message for a blocked request. */
export function rateLimitMessage(): string {
  return "Too many attempts. Please wait a few minutes and try again.";
}
