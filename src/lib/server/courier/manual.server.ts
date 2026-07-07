/**
 * Manual courier adapter — for hand-delivery, Sundarban, RedX, or any
 * courier booked outside the system.
 *
 * No external API call. Requires a valid tracking code/reference from admin.
 * Always succeeds (the "booking" is just persisting what the admin entered).
 */
import type {
  CourierAdapter,
  CourierBookingRequest,
  CourierBookingResult,
  CourierStatusResult,
} from "./types";

export const manualAdapter: CourierAdapter = {
  provider: "manual",

  async book(req: CourierBookingRequest): Promise<CourierBookingResult> {
    // The tracking code comes from the server function layer, which validates
    // it before calling this adapter. But we defend here too.
    // For manual, the orderNo serves as the consignment reference.
    return {
      success: true,
      consignmentId: null, // no courier-side ID for manual
      trackingCode: null,  // tracking code is set by the caller (courier.server.ts)
      rawResponse: { manual: true, orderNo: req.orderNo },
    };
  },

  async checkStatus(consignmentId: string): Promise<CourierStatusResult> {
    // Manual shipments have no external status to poll.
    return {
      consignmentId,
      status: "manual",
      updatedAt: null,
      rawResponse: null,
    };
  },

  // Manual shipments don't have a courier to cancel with.
  async cancel() {
    return { success: true }; // always "succeeds" — cancellation is just our own record
  },
};
