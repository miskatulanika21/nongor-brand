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
  /**
   * Full delivery address. Pathao auto-resolves city/zone from this when no
   * explicit ids are supplied — see recipientCityId / recipientZoneId.
   */
  recipientAddress: string;
  district: string;
  /**
   * Pathao's own city / zone / area ids, when the order carried a resolved
   * location. Supplying them removes the dependence on Pathao parsing the
   * free-text address, which mis-routes on unstructured Bangladeshi addresses
   * and costs a return fee on COD. Absent → auto-address, exactly as before.
   */
  recipientCityId?: number;
  recipientZoneId?: number;
  recipientAreaId?: number;
  /**
   * Amount the courier should collect on delivery.
   * Computed server-side: COD → amount_due, prepaid → 0.
   */
  codAmount: number;
  note?: string;
  /** Customer email, when known. SteadFast sends delivery notifications to it. */
  recipientEmail?: string;
  /** Short parcel contents description — helps couriers handle damage disputes. */
  itemDescription?: string;
  /** Parcel weight in kg. From courier_providers.default_weight_kg. */
  weight?: number;
  /**
   * Provider-specific service type, from courier_providers.default_service_type.
   *
   * The vocabulary differs per provider and is NOT interchangeable:
   *   SteadFast → delivery_type, numeric: '0' = home, '1' = hub pickup
   *   Pathao    → delivery_type, numeric: '48' = standard, '12' = on-demand
   *
   * Each adapter validates this against its OWN vocabulary and ignores a value
   * it cannot understand, so a mis-seeded row degrades to the provider default
   * instead of being POSTed into a field that rejects it.
   */
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

  /**
   * Ask the courier to collect the parcel back from the customer.
   *
   * Optional because support is genuinely uneven: SteadFast exposes
   * POST /create_return_request, Pathao has no public equivalent (returns are
   * raised from their merchant panel). Callers must treat an absent method as
   * "this courier cannot do it via API" and fall back to a manual record —
   * never as an error.
   */
  createReturn?(consignmentId: string, reason?: string): Promise<CourierReturnResult>;
}

/** Result of asking a courier to raise a return request. */
export interface CourierReturnResult {
  success: boolean;
  /** The courier's own return-request id, when it issues one. */
  returnRequestId: string | null;
  /** Provider-side status, e.g. SteadFast: pending|approved|processing|completed|cancelled. */
  status: string | null;
  rawResponse?: unknown;
  error?: string;
}
