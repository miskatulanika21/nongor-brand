/**
 * Courier adapter factory.
 *
 * Returns the correct CourierAdapter for a given provider key.
 * Validates that required env credentials are present before returning.
 */
import process from "node:process";
import type { CourierAdapter } from "./types";
import { steadfastAdapter } from "./steadfast.server";
import { pathaoAdapter } from "./pathao.server";
import { manualAdapter } from "./manual.server";

export class CourierConfigError extends Error {
  readonly code = "provider_not_configured" as const;
  constructor(message: string) {
    super(message);
    this.name = "CourierConfigError";
  }
}

/**
 * Get the courier adapter for a provider.
 *
 * @throws CourierConfigError if the provider is unknown or its env credentials
 *         are not configured.
 */
export function getCourierAdapter(provider: string): CourierAdapter {
  switch (provider) {
    case "steadfast": {
      if (!process.env.STEADFAST_API_KEY || !process.env.STEADFAST_SECRET_KEY) {
        throw new CourierConfigError(
          "SteadFast is not configured. Set STEADFAST_API_KEY and STEADFAST_SECRET_KEY in env.",
        );
      }
      return steadfastAdapter;
    }

    case "pathao": {
      const hasProduction = process.env.PATHAO_CLIENT_ID && process.env.PATHAO_CLIENT_SECRET;
      const hasSandbox =
        process.env.PATHAO_SANDBOX_CLIENT_ID && process.env.PATHAO_SANDBOX_CLIENT_SECRET;
      if (!hasProduction && !hasSandbox) {
        throw new CourierConfigError(
          "Pathao is not configured. Set PATHAO_CLIENT_ID / PATHAO_CLIENT_SECRET (or sandbox equivalents) in env.",
        );
      }
      if (!process.env.PATHAO_STORE_ID) {
        throw new CourierConfigError(
          "Pathao store_id is not configured. Set PATHAO_STORE_ID in env or fetch via the /stores endpoint.",
        );
      }
      return pathaoAdapter;
    }

    case "manual":
      return manualAdapter;

    default:
      throw new CourierConfigError(`Unknown courier provider: "${provider}"`);
  }
}

/** Quick check: are any courier providers configured? */
export function hasAnyCourierConfigured(): boolean {
  const hasSteadfast = !!(process.env.STEADFAST_API_KEY && process.env.STEADFAST_SECRET_KEY);
  const hasPathao = !!(
    (process.env.PATHAO_CLIENT_ID && process.env.PATHAO_CLIENT_SECRET) ||
    (process.env.PATHAO_SANDBOX_CLIENT_ID && process.env.PATHAO_SANDBOX_CLIENT_SECRET)
  );
  // Manual is always available
  return hasSteadfast || hasPathao || true;
}

// Re-export types for convenience
export type { CourierAdapter, CourierBookingRequest, CourierBookingResult, CourierStatusResult } from "./types";
