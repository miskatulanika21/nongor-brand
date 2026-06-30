/**
 * Admin order detail + lifecycle actions (P4c).
 *
 * Loads the full order via getOrderDetailFn (items / payment / screenshots /
 * status-history timeline) and renders the actions allowed from the current
 * status via nextActions(). Each action confirms in a dialog (with a reason input
 * where the RPC takes one, and a restock toggle for returns) and dispatches to the
 * matching guarded server fn. Generic transitions carry the loaded `version` as
 * expected_version so two admins acting at once get a version_conflict instead of
 * a silent clobber; after any change we re-fetch the detail and invalidate the
 * board loader (onMutated).
 */
import { useEffect, useState } from "react";
import {
  getOrderDetailFn,
  transitionOrderFn,
  verifyPaymentFn,
  rejectPaymentFn,
  confirmCodFn,
  cancelOrderFn,
  returnOrderFn,
} from "@/lib/orders.api";
import {
  nextActions,
  ORDER_STATUS_META,
  type OrderAction,
  type OrderDetail,
} from "@/lib/orders-shared";
import { StatusBadge, fmtDate, fmtDateTime } from "./order-status";
import { formatBDT } from "@/lib/brand";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2, PackageOpen, Paperclip } from "lucide-react";
import { toast } from "sonner";

interface Props {
  orderId: string | null;
  onClose: () => void;
  onMutated: () => void;
}

type ActionResult = { success: boolean; error?: string };

async function dispatchAction(
  action: OrderAction,
  orderId: string,
  version: number,
  reason: string | undefined,
  restock: boolean,
): Promise<ActionResult> {
  switch (action.rpc) {
    case "verify_payment":
      return verifyPaymentFn({ data: { orderId } });
    case "reject_payment":
      return rejectPaymentFn({ data: { orderId, reason: reason ?? "" } });
    case "confirm_cod":
      return confirmCodFn({ data: { orderId } });
    case "cancel":
      return cancelOrderFn({ data: { orderId, reason } });
    case "return":
      return returnOrderFn({ data: { orderId, restock, reason } });
    case "transition":
      return transitionOrderFn({
        data: { orderId, toStatus: action.toStatus, reason, expectedVersion: version },
      });
  }
}

export function OrderDetailSheet({ orderId, onClose, onMutated }: Props) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activeAction, setActiveAction] = useState<OrderAction | null>(null);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);

  const resetAction = () => {
    setActiveAction(null);
    setReason("");
    setRestock(false);
  };

  async function load(id: string) {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await getOrderDetailFn({ data: { orderId: id } });
      if (res.success) setDetail(res.order);
      else {
        setDetail(null);
        setLoadError(true);
      }
    } catch {
      setDetail(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    resetAction();
    if (!orderId) {
      setDetail(null);
      setLoadError(false);
      return;
    }
    void load(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function runAction() {
    if (!detail || !activeAction) return;
    const action = activeAction;
    const trimmed = reason.trim() || undefined;
    if (action.requiresReason && !trimmed) {
      toast.error("Please enter a reason.");
      return;
    }
    setBusy(true);
    try {
      const res = await dispatchAction(
        action,
        detail.order.id,
        detail.order.version,
        trimmed,
        restock,
      );
      if (res.success) {
        toast.success(`${action.label} complete.`);
        resetAction();
        await load(detail.order.id);
        onMutated();
      } else {
        // A version_conflict / stale state is surfaced verbatim; re-fetch so the
        // admin immediately sees the order's real current state.
        toast.error(res.error ?? "Could not complete the change.");
        resetAction();
        await load(detail.order.id);
      }
    } catch {
      toast.error("Could not complete the change. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const actions = detail ? nextActions(detail.order.status) : [];

  return (
    <>
      <Sheet open={!!orderId} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {loading && <DetailSkeleton />}

          {!loading && loadError && (
            <p className="mt-8 text-sm text-destructive">
              Could not load this order. Close and try again.
            </p>
          )}

          {!loading && detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-2xl">{detail.order.orderNo}</SheetTitle>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <StatusBadge status={detail.order.status} />
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(detail.order.placedAt)}
                  </span>
                </div>

                <div className="rounded-lg bg-secondary p-3">
                  <p className="font-medium text-foreground">{detail.order.customerName}</p>
                  <p className="text-muted-foreground">{detail.order.customerPhone}</p>
                  {detail.order.customerEmail && (
                    <p className="text-muted-foreground">{detail.order.customerEmail}</p>
                  )}
                  <p className="text-muted-foreground">
                    {detail.order.shipAddress}
                    {detail.order.shipArea ? `, ${detail.order.shipArea}` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    {detail.order.shipDistrict} · {detail.order.shipZone}
                  </p>
                </div>

                <div className="space-y-2">
                  {detail.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3">
                      {it.image ? (
                        <img src={it.image} alt="" className="h-12 w-10 rounded object-cover" />
                      ) : (
                        <div className="grid h-12 w-10 place-items-center rounded bg-muted text-muted-foreground">
                          <PackageOpen className="h-4 w-4" />
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="line-clamp-1 text-foreground">{it.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Qty {it.qty}
                          {it.variantSize ? ` · ${it.variantSize}` : ""}
                        </p>
                      </div>
                      <span className="font-medium">{formatBDT(it.lineTotal)}</span>
                    </div>
                  ))}
                </div>

                <Separator />
                <div className="space-y-1">
                  <Row label="Subtotal" value={formatBDT(detail.order.subtotal)} />
                  {detail.order.discount > 0 && (
                    <Row label="Discount" value={`− ${formatBDT(detail.order.discount)}`} />
                  )}
                  <Row
                    label="Delivery"
                    value={
                      detail.order.shippingFee === 0 ? "Free" : formatBDT(detail.order.shippingFee)
                    }
                  />
                  <div className="flex justify-between pt-1 text-base font-semibold text-primary">
                    <span>Total</span>
                    <span>{formatBDT(detail.order.total)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="mb-1 font-medium">Payment</p>
                  <p className="capitalize text-muted-foreground">
                    {detail.order.paymentMethod}
                    {detail.payment ? ` · ${detail.payment.status}` : ""}
                  </p>
                  {detail.payment?.senderNumber && (
                    <p className="text-muted-foreground">Sender: {detail.payment.senderNumber}</p>
                  )}
                  {detail.payment?.trxId && (
                    <p className="text-muted-foreground">
                      TrxID:{" "}
                      <span className="font-medium text-foreground">{detail.payment.trxId}</span>
                    </p>
                  )}
                  {detail.payment?.rejectReason && (
                    <p className="text-destructive">Rejected: {detail.payment.rejectReason}</p>
                  )}
                  {detail.screenshots.length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" />
                      {detail.screenshots.length} payment screenshot
                      {detail.screenshots.length > 1 ? "s" : ""} on file — secure preview coming
                      soon.
                    </p>
                  )}
                </div>

                {detail.history.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium">History</p>
                    <ol className="space-y-2 border-l border-border pl-4">
                      {detail.history.map((h, i) => (
                        <li key={i} className="relative">
                          <span className="absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full bg-primary" />
                          <p className="text-foreground">
                            {h.fromStatus ? `${ORDER_STATUS_META[h.fromStatus].label} → ` : ""}
                            {ORDER_STATUS_META[h.toStatus].label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDateTime(h.createdAt)}
                          </p>
                          {h.reason && <p className="text-xs text-muted-foreground">{h.reason}</p>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <Separator />
                <div className="space-y-2">
                  <p className="font-medium">Actions</p>
                  {actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No further actions for this status.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {actions.map((a) => (
                        <Button
                          key={a.key}
                          size="sm"
                          variant={a.destructive ? "outline" : "default"}
                          className={cn(
                            a.destructive &&
                              "border-destructive/40 text-destructive hover:bg-destructive/10",
                          )}
                          onClick={() => {
                            setReason("");
                            setRestock(false);
                            setActiveAction(a);
                          }}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!activeAction} onOpenChange={(o) => !o && resetAction()}>
        <DialogContent>
          {activeAction && detail && (
            <>
              <DialogHeader>
                <DialogTitle>{activeAction.label}</DialogTitle>
                <DialogDescription>
                  {activeAction.label} for order{" "}
                  <span className="font-medium text-foreground">{detail.order.orderNo}</span>?
                </DialogDescription>
              </DialogHeader>

              {(activeAction.requiresReason || activeAction.optionalReason) && (
                <div className="space-y-1.5">
                  <Label htmlFor="action-reason">
                    Reason{activeAction.requiresReason ? "" : " (optional)"}
                  </Label>
                  <Textarea
                    id="action-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Add a short note for the order history…"
                  />
                </div>
              )}

              {activeAction.allowsRestock && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="action-restock"
                    checked={restock}
                    onCheckedChange={(v) => setRestock(v === true)}
                  />
                  <Label htmlFor="action-restock" className="font-normal">
                    Return items to stock
                  </Label>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={resetAction} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant={activeAction.destructive ? "destructive" : "default"}
                  onClick={runAction}
                  disabled={busy}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-8 space-y-3" role="status" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" /> Loading order…
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 rounded-lg border border-border bg-secondary" />
      ))}
    </div>
  );
}
