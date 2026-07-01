import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { PaymentBadge, fmtDateTime } from "@/components/admin/order-status";
import { OrderDetailSheet } from "@/components/admin/OrderDetailSheet";
import { listOrdersFn } from "@/lib/orders.api";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

// The manual-payment review queue = orders sitting in `payment_submitted`
// (a customer sent a TrxID/screenshot and is waiting on verification). Verify /
// reject live in the shared OrderDetailSheet so there is one action surface for
// the whole order pipeline — this screen is just the payment-focused list.
const REVIEW_STATUS = "payment_submitted" as const;
const QUEUE_LIMIT = 50;

export const Route = createFileRoute("/admin/payments")({
  head: () => ({ meta: [{ title: "Payments · Nongorr Admin" }] }),
  loader: async () => {
    const res = await listOrdersFn({
      data: { status: REVIEW_STATUS, limit: QUEUE_LIMIT, offset: 0 },
    });
    return { orders: res.orders, total: res.total, loadError: !res.success };
  },
  component: Payments,
});

function Payments() {
  const { orders, total, loadError } = Route.useLoaderData();
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div>
      <AdminHeader
        title="Payments"
        description="Verify manual bKash / Nagad payments before confirming orders."
      />

      {loadError ? (
        <ErrorPanel onRetry={() => router.invalidate()} />
      ) : orders.length === 0 ? (
        <EmptyPanel />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            {total > QUEUE_LIMIT
              ? `Showing the ${QUEUE_LIMIT} oldest of ${total} payments awaiting review.`
              : `${total} payment${total === 1 ? "" : "s"} awaiting review.`}{" "}
            <Link
              to="/admin/orders"
              search={{ status: REVIEW_STATUS }}
              className="text-primary underline-offset-4 hover:underline"
            >
              Open in the orders board
            </Link>
          </p>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Payable</TableHead>
                  <TableHead>Method · TrxID</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => setActiveId(o.id)}>
                    <TableCell>
                      <p className="font-medium text-foreground">{o.orderNo}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(o.placedAt)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-foreground">{o.customerName}</p>
                      <p className="text-xs text-muted-foreground">{o.customerPhone}</p>
                    </TableCell>
                    <TableCell className="font-medium text-primary">{formatBDT(o.total)}</TableCell>
                    <TableCell>
                      <p className="text-xs uppercase text-muted-foreground">{o.paymentMethod}</p>
                      <p className="font-mono text-sm text-foreground">{o.payment?.trxId ?? "—"}</p>
                    </TableCell>
                    <TableCell>{o.payment && <PaymentBadge status={o.payment.status} />}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <OrderDetailSheet
        orderId={activeId}
        onClose={() => setActiveId(null)}
        onMutated={() => router.invalidate()}
      />
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">No payments awaiting review</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Manual payments appear here as soon as customers submit a transaction ID and screenshot.
      </p>
    </div>
  );
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">Could not load payments</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong loading the review queue. Please retry.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
