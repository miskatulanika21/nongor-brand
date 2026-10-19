/**
 * Vercel BotID gate for abusable public writes — SERVER ONLY.
 *
 * The browser half (`initBotId` in __root.tsx) attaches BotID's signed
 * classification headers to every server-function POST; here we ask Vercel
 * whether the caller is an automated client. This is the layer rate limits
 * cannot provide: a bot rotating IPs and accounts stays under every per-IP and
 * per-account bucket, but still fails the browser challenge.
 *
 * Rollout is staged like the CSP (Report-Only before enforced):
 *   BOTID_MODE=monitor (default) — classify and LOG bots, never block. Review
 *                                  the "BotID flagged" logs, especially for
 *                                  in-app browsers, before enforcing.
 *   BOTID_MODE=enforce           — reject requests classified as bots.
 *   BOTID_MODE=off               — skip the check entirely.
 *
 * Verified good bots (search crawlers, uptime monitors) are never blocked.
 * Off Vercel (local dev, CI, tests) there is nothing to verify against, so the
 * check is skipped. A BotID outage fails OPEN — like the rate limiter, a
 * protection-layer failure must not take checkout down with it.
 */
import process from "node:process";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { safeServerLog } from "./security.server";

export type BotIdMode = "monitor" | "enforce" | "off";

export function botIdMode(): BotIdMode {
  const raw = (process.env.BOTID_MODE ?? "").trim().toLowerCase();
  return raw === "enforce" || raw === "off" ? raw : "monitor";
}

/** Plain header record in the shape botid/server accepts. */
function requestHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(getRequestHeaders())) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * True when this request should be REJECTED as a bot (enforce mode only).
 * In monitor mode a bot classification is logged and false is returned.
 */
export async function isBlockedBot(action: string): Promise<boolean> {
  const mode = botIdMode();
  if (mode === "off" || process.env.VERCEL !== "1") return false;

  try {
    const { checkBotId } = await import("botid/server");
    const verdict = await checkBotId({ advancedOptions: { headers: requestHeaders() } });
    if (!verdict.isBot || verdict.isVerifiedBot) return false;

    safeServerLog("warn", "BotID flagged request", { action, mode });
    return mode === "enforce";
  } catch (err) {
    safeServerLog("error", "BotID check failed (failing open)", {
      action,
      error: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}

/** Generic message: never tell an automated client what tripped it. */
export function botBlockedMessage(): string {
  return "We couldn't verify this request. Please refresh the page and try again.";
}
