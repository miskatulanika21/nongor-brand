/**
 * Courier adapter interface — the contract every courier integration must fulfil.
 *
 * Isomorphic type definitions only (no server imports). The actual adapters
 * live in .server.ts files and are never bundled to the client.
 */

// ── Booking request / result ─────────────────────────────────────────────────

/** Canonical booking payload sent to any courier adapter. */
export interface CourierBookingRequest {
  /** Nongorr order number, e.g. "NGR-2026-000123". */
  orderNo: string;
  recipientName: string;
  /** Normalized Bangladesh mobile: 01XXXXXXXXX. */
  recipientPhone: string;
  /** Full delivery address (Pathao auto-resolves city/zone from this). */
  recipientAddress: string;
  district: string;
  /**
   * Amount the courier should collect on delivery.
   * Computed server-side: COD → amount_due, prepaid → 0.
   */
  codAmount: number;
  note?: string;
  /** Parcel weight in kg. From courier_providers.default_weight_kg. */
  weight?: number;
  /** Provider-specific service type, e.g. 'normal' (SteadFast), '48' (Pathao). */
  serviceType?: string;
}

/** Result returned by every adapter's book() method. */
export interface CourierBookingResult {
  success: boolean;
  /** Courier's own consignment/order ID. */
  consignmentId: string | null;
  /** Public tracking code (may differ from consignment ID). */
  trackingCode: string | null;
  /** Raw courier response body (stored in shipment_events for debugging). */
  rawResponse?: unknown;
  /** Human-readable error on failure. */
  error?: string;
}

// ── Status check ─────────────────────────────────────────────────────────────

/** Result from polling a courier for current shipment status. */
export interface CourierStatusResult {
  consignmentId: string;
  /** Raw courier status string (mapped to internal statuses by the caller). */
  status: string;
  updatedAt: string | null;
  rawResponse?: unknown;
}

// ── The adapter interface ────────────────────────────────────────────────────

/**
 * Every courier integration implements this interface. Adapters are
 * instantiated by the factory in index.ts and called from courier.server.ts.
 *
 * Adapters must:
 *   - Never hold DB connections or transactions
 *   - Never store secrets in memory beyond the current request
 *   - Timeout within 15s (configurable per adapter)
 *   - Return structured results, never throw for expected API errors
 */
export interface CourierAdapter {
  /** Provider key matching courier_providers.id, e.g. 'steadfast'. */
  readonly provider: string;

  /** Book a parcel with the courier. */
  book(req: CourierBookingRequest): Promise<CourierBookingResult>;

  /** Poll the courier for current shipment status. */
  checkStatus(consignmentId: string): Promise<CourierStatusResult>;

  /** Cancel a booked shipment, if the courier supports it. */
  cancel?(consignmentId: string): Promise<{ success: boolean; error?: string }>;
}
