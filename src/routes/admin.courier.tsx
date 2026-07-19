/**
 * Admin courier page — book, track, and manage courier shipments.
 *
 * Shows orders that are ready_to_ship / courier_booked / delivery_failed.
 * Uses the real courier.api.ts server functions instead of mock data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  MapPin,
  RefreshCw,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Undo2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { listOrdersFn } from "@/lib/orders.api";
import {
  bookCourierFn,
  cancelShipmentFn,
  createReturnFn,
  listShipmentsFn,
  listCourierProvidersFn,
  pollShipmentStatusFn,
} from "@/lib/courier.api";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatBDT } from "@/lib/brand";
import { orderStatusMeta, type OrderStatus } from "@/lib/orders-shared";
import type { CourierProviderId } from "@/lib/courier-shared";

export const Route = createFileRoute("/admin/courier")({
  head: () => ({ meta: [{ title: "Courier · Nongorr Admin" }] }),
  component: CourierPage,
});

// ── Courier status colors ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  ready_to_ship: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  courier_booked: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  shipped: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  delivery_failed: "bg-red-500/10 text-red-400 border-red-500/30",
  delivered: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

const BOOKABLE_STATUSES: OrderStatus[] = ["ready_to_ship", "courier_booked", "delivery_failed"];

function CourierPage() {
  const confirm = useConfirm();
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      orderNo: string;
      customerName: string;
      customerPhone: string;
      shipDistrict: string;
      shipZone: string;
      total: number;
      status: OrderStatus;
      paymentMethod: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [providers, setProviders] = useState<
    Array<{ id: string; display_name: string; enabled: boolean }>
  >([]);
  const [bookingState, setBookingState] = useState<
    Record<
      string,
      {
        provider: CourierProviderId;
        trackingCode: string;
        loading: boolean;
      }
    >
  >({});
  const [shipments, setShipments] = useState<
    Record<
      string,
      Array<{
        id: string;
        provider: string;
        booking_status: string;
        tracking_code: string | null;
        consignment_id: string | null;
        courier_status: string | null;
        created_at: string;
        cancelled_at: string | null;
      }>
    >
  >({});

  // ── Load orders ──────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      // Load courier-bookable orders
      const results = await Promise.all(
        BOOKABLE_STATUSES.map((status) => listOrdersFn({ data: { status, limit: 100 } })),
      );
      const all = results
        .filter((r) => r.success)
        .flatMap((r) =>
          r.orders.map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            customerName: o.customerName,
            customerPhone: o.customerPhone,
            shipDistrict: o.shipDistrict,
            shipZone: o.shipZone,
            total: o.total,
            status: o.status,
            paymentMethod: o.paymentMethod,
          })),
        );
      setOrders(all);
      setLoaded(true);

      // Load providers
      const provResult = await listCourierProvidersFn();
      if (provResult.success) {
        setProviders(
          (
            provResult.providers as Array<{ id: string; display_name: string; enabled: boolean }>
          ).filter((p) => p.enabled),
        );
      }

      // Load shipments for each order.
      // Failures must be visible: silently skipping them renders a booked order
      // as though it has no shipment — no tracking code, no Cancel button — which
      // is exactly how the broken api.list_shipments went unnoticed for so long.
      const shipMap: typeof shipments = {};
      let shipmentLoadFailures = 0;
      for (const o of all) {
        try {
          const shipResult = await listShipmentsFn({ data: { orderId: o.id } });
          if (shipResult.success && Array.isArray(shipResult.shipments)) {
            shipMap[o.id] = shipResult.shipments as (typeof shipments)[string];
          } else {
            shipmentLoadFailures++;
          }
        } catch {
          shipmentLoadFailures++;
        }
      }
      setShipments(shipMap);
      if (shipmentLoadFailures > 0) {
        toast.error(
          `Could not load shipment details for ${shipmentLoadFailures} order(s). ` +
            `Tracking and cancel actions may be missing.`,
        );
      }
    } catch {
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Book courier ─────────────────────────────────────────────────────────
  const handleBook = useCallback(
    async (orderId: string) => {
      const state = bookingState[orderId];
      if (!state || state.loading) return;

      setBookingState((prev) => ({
        ...prev,
        [orderId]: { ...state, loading: true },
      }));

      try {
        const result = await bookCourierFn({
          data: {
            orderId,
            provider: state.provider,
            trackingCode: state.provider === "manual" ? state.trackingCode : undefined,
          },
        });

        if (result.success) {
          toast.success(`Courier booked! Tracking: ${result.trackingCode ?? "pending"}`);
          await loadOrders(); // refresh
        } else {
          toast.error(result.error ?? "Booking failed");
        }
      } catch {
        toast.error("Booking failed — check console");
      } finally {
        setBookingState((prev) => ({
          ...prev,
          [orderId]: { ...state, loading: false },
        }));
      }
    },
    [bookingState, loadOrders],
  );

  // ── Poll status ──────────────────────────────────────────────────────────
  const handlePoll = useCallback(
    async (shipmentId: string) => {
      try {
        const result = await pollShipmentStatusFn({ data: { shipmentId } });
        if (result.success) {
          toast.success(`Status updated: ${result.status}`);
          await loadOrders();
        } else {
          toast.error(result.error ?? "Could not poll status");
        }
      } catch {
        toast.error("Poll failed");
      }
    },
    [loadOrders],
  );

  // ── Raise a return leg ───────────────────────────────────────────────────
  const handleReturn = useCallback(
    async (shipmentId: string) => {
      const ok = await confirm({
        title: "Request a return?",
        description:
          "This asks the courier to collect the parcel back from the customer. " +
          "A return fee usually applies and it cannot be undone from here.",
        confirmText: "Request return",
      });
      if (!ok) return;

      try {
        const result = await createReturnFn({ data: { parentShipmentId: shipmentId } });
        if (result.success) {
          // A provider without a return API still records the leg — say so
          // plainly rather than implying the courier was actually notified.
          toast.success(
            result.manual
              ? "Return recorded. This courier has no return API — raise it in their merchant panel too."
              : `Return requested${result.returnRequestId ? ` (${result.returnRequestId})` : ""}.`,
          );
          await loadOrders();
        } else {
          toast.error(result.error ?? "Could not request return");
        }
      } catch {
        toast.error("Return request failed");
      }
    },
    [confirm, loadOrders],
  );

  // ── Cancel shipment ──────────────────────────────────────────────────────
  const handleCancel = useCallback(
    async (shipmentId: string) => {
      try {
        const result = await cancelShipmentFn({ data: { shipmentId } });
        if (result.success) {
          toast.success("Shipment cancelled");
          await loadOrders();
        } else {
          toast.error(result.error ?? "Cancel failed");
        }
      } catch {
        toast.error("Cancel failed");
      }
    },
    [loadOrders],
  );

  // Auto-load on first render
  if (!loaded && !loading) {
    void loadOrders();
  }

  return (
    <div>
      <AdminHeader
        title="Courier"
        description="Book parcels, track shipments, and manage deliveries."
      />

      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Truck className="h-4 w-4 text-gold" />
          <span>{orders.length} order(s) ready for courier</span>
        </div>
        <Button size="sm" variant="outline" onClick={loadOrders} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Loading state */}
      {loading && !loaded && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      )}

      {/* Empty state */}
      {loaded && orders.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          No orders ready for courier right now.
        </div>
      )}

      {/* Order cards */}
      <div className="space-y-3">
        {orders.map((o) => {
          const meta = orderStatusMeta(o.status);
          const orderShipments = shipments[o.id] ?? [];
          const activeShipment = orderShipments.find(
            (s) => s.booking_status === "success" && !s.cancelled_at,
          );
          const pendingShipment = orderShipments.find(
            (s) => s.booking_status === "pending" && !s.cancelled_at,
          );
          const bs = bookingState[o.id] ?? {
            provider: providers[0]?.id ?? "steadfast",
            trackingCode: "",
            loading: false,
          };

          return (
            <div
              key={o.id}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-border/80"
            >
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Left: Order info */}
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-lg text-foreground">{o.orderNo}</p>
                    <Badge
                      variant="outline"
                      className={STATUS_COLORS[o.status] ?? "border-border text-muted-foreground"}
                    >
                      {meta.label}
                    </Badge>
                    {o.status === "delivery_failed" && (
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                    )}
                  </div>
                  <p className="text-sm text-foreground">
                    {o.customerName} · {o.customerPhone}
                  </p>
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {o.shipZone}, {o.shipDistrict}
                  </p>
                  <p className="mt-1 text-sm font-medium text-gold">
                    {formatBDT(o.total)} · {o.paymentMethod === "cod" ? "COD" : "Prepaid"}
                  </p>

                  {/* Active shipment info */}
                  {activeShipment && (
                    <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                        <span className="font-medium text-emerald-400">Booked</span>
                        <Badge variant="outline" className="text-xs">
                          {activeShipment.provider}
                        </Badge>
                      </div>
                      {activeShipment.tracking_code && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Tracking: {activeShipment.tracking_code}
                        </p>
                      )}
                      {activeShipment.courier_status && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Status: {activeShipment.courier_status}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handlePoll(activeShipment.id)}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" /> Refresh status
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleReturn(activeShipment.id)}
                        >
                          <Undo2 className="mr-1 h-3 w-3" /> Request return
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-400 hover:text-red-300"
                          onClick={() => handleCancel(activeShipment.id)}
                        >
                          <XCircle className="mr-1 h-3 w-3" /> Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Pending shipment warning */}
                  {pendingShipment && (
                    <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                        <span className="text-amber-400">Booking in progress…</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Booking controls (only if no active shipment) */}
                {!activeShipment && !pendingShipment && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Courier partner</Label>
                      <Select
                        value={bs.provider}
                        onValueChange={(v) =>
                          setBookingState((prev) => ({
                            ...prev,
                            [o.id]: { ...bs, provider: v as CourierProviderId },
                          }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* `providers` already includes the seeded "manual"
                              row (20260707150000_stage5_courier_schema.sql), so
                              this list must not append its own Manual item. */}
                          {providers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.display_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {bs.provider === "manual" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Tracking code</Label>
                        <Input
                          className="h-9"
                          placeholder="Enter tracking code"
                          value={bs.trackingCode}
                          onChange={(e) =>
                            setBookingState((prev) => ({
                              ...prev,
                              [o.id]: { ...bs, trackingCode: e.target.value },
                            }))
                          }
                        />
                      </div>
                    )}

                    <div className={bs.provider === "manual" ? "col-span-2" : "space-y-1.5"}>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={
                          bs.loading ||
                          (bs.provider === "manual" && bs.trackingCode.trim().length < 2)
                        }
                        onClick={() => handleBook(o.id)}
                      >
                        {bs.loading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Truck className="mr-2 h-4 w-4" />
                        )}
                        Book courier
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
