import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { listOrdersFn } from "@/lib/orders.api";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  ORDER_LANES,
  ORDER_LANE_LABEL,
  isOrderStatus,
  type OrderStatus,
  type OrderListRow,
  type PaymentStatus,
  type StatusTone,
} from "@/lib/orders-shared";
import { formatBDT } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronLeft, ChevronRight, PackageOpen, Search } from "lucide-react";

// Page size — must match the loader's `limit` so pagination math is correct.
const PAGE_SIZE = 20;

interface OrdersSearch {
  status?: OrderStatus;
  q?: string;
  // Optional so links elsewhere (e.g. the dashboard) can target /admin/orders
  // without supplying search; validateSearch always normalizes it to >= 1.
  page?: number;
}

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders · Nongorr Admin" }] }),
  // URL is the source of truth for filters → shareable, back-button friendly, and
  // every change re-runs the loader against the server (no client-side guessing).
  validateSearch: (s: Record<string, unknown>): OrdersSearch => {
    const status = typeof s.status === "string" && isOrderStatus(s.status) ? s.status : undefined;
    const q = typeof s.q === "string" && s.q.trim() ? s.q.trim().slice(0, 100) : undefined;
    const pageNum = Number(s.page);
    const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
    return { status, q, page };
  },
  loaderDeps: ({ search }) => ({ status: search.status, q: search.q, page: search.page }),
  loader: async ({ deps }) => {
    const page = deps.page ?? 1;
    const res = await listOrdersFn({
      data: {
        status: deps.status,
        search: deps.q,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    });
    return { orders: res.orders, total: res.total, loadError: !res.success };
  },
  component: OrdersAdmin,
});

// Abstract status tone → brand badge classes (single mapping for all 6 tones).
const TONE_BADGE: Record<StatusTone, string> = {
  amber: "bg-gold/20 text-gold-foreground border-gold/40",
  blue: "bg-secondary text-secondary-foreground border-border",
  violet: "bg-primary/10 text-primary border-primary/30",
  green: "bg-success/15 text-success border-success/30",
  red: "bg-destructive/10 text-destructive border-destructive/30",
  slate: "bg-muted text-muted-foreground border-border",
};

const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  verified: "border-success/40 text-success",
  rejected: "border-destructive/40 text-destructive",
  pending: "border-gold/40 text-primary",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic (UTC) date — avoids SSR/client locale-timezone hydration drift.
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(TONE_BADGE[meta.tone])}>
      {meta.label}
    </Badge>
  );
}

function OrdersAdmin() {
  const { orders, total, loadError } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [active, setActive] = useState<OrderListRow | null>(null);
  const [term, setTerm] = useState(search.q ?? "");

  // Keep the input in sync when the URL changes elsewhere (back/forward, reset).
  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  // Debounce the search box → push `q` into the URL (resetting to page 1). The
  // equality guard stops this from looping against the sync effect above.
  useEffect(() => {
    const next = term.trim() || undefined;
    if (next === (search.q ?? undefined)) return;
    const id = setTimeout(() => {
      navigate({
        to: "/admin/orders",
        search: { status: search.status, q: next, page: 1 },
      });
    }, 350);
    return () => clearTimeout(id);
  }, [term, search.q, search.status, navigate]);

  const setStatus = (status: OrderStatus | undefined) =>
    navigate({ to: "/admin/orders", search: { status, q: search.q, page: 1 } });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, totalPages);
  const goto = (p: number) =>
    navigate({
      to: "/admin/orders",
      search: { status: search.status, q: search.q, page: Math.min(Math.max(1, p), totalPages) },
    });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <AdminHeader
        title="Orders"
        description="Search, filter and work the order pipeline end to end."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by order no, name or phone…"
            className="pl-9"
          />
        </div>
        <Select
          value={search.status ?? "all"}
          onValueChange={(v) => setStatus(v === "all" ? undefined : (v as OrderStatus))}
        >
          <SelectTrigger className="sm:w-[230px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_LANES.map((lane) => (
              <SelectGroup key={lane}>
                <SelectLabel>{ORDER_LANE_LABEL[lane]}</SelectLabel>
                {ORDER_STATUSES.filter((s) => ORDER_STATUS_META[s].lane === lane).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadError ? (
        <ErrorPanel onRetry={() => router.invalidate()} />
      ) : orders.length === 0 ? (
        <EmptyPanel filtered={Boolean(search.status || search.q)} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => setActive(o)}>
                    <TableCell>
                      <p className="font-medium text-foreground">{o.orderNo}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(o.placedAt)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-foreground">{o.customerName}</p>
                      <p className="text-xs text-muted-foreground">{o.customerPhone}</p>
                    </TableCell>
                    <TableCell className="font-medium text-primary">{formatBDT(o.total)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs uppercase text-muted-foreground">
                          {o.paymentMethod}
                        </span>
                        {o.payment && (
                          <Badge
                            variant="outline"
                            className={cn("w-fit capitalize", PAYMENT_BADGE[o.payment.status])}
                          >
                            {o.payment.status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>
              Showing {rangeStart}–{rangeEnd} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => goto(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => goto(page + 1)}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <OrderSummarySheet order={active} onClose={() => setActive(null)} />
    </div>
  );
}

function EmptyPanel({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        <PackageOpen className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">No orders found</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "No orders match the current filters. Try clearing the search or status."
          : "Orders will appear here as soon as customers start placing them."}
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
      <h3 className="font-display text-xl text-foreground">Could not load orders</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong loading the order list. Please retry.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// Read-only summary built from the list row. Full detail (status history, payment
// evidence) and lifecycle actions arrive with the order detail surface (P4c).
function OrderSummarySheet({
  order,
  onClose,
}: {
  order: OrderListRow | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-2xl">{order.orderNo}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <StatusBadge status={order.status} />
                <span className="text-xs text-muted-foreground">{fmtDate(order.placedAt)}</span>
              </div>

              <div className="rounded-lg bg-secondary p-3">
                <p className="font-medium text-foreground">{order.customerName}</p>
                <p className="text-muted-foreground">{order.customerPhone}</p>
                <p className="text-muted-foreground">
                  {order.shipDistrict} · {order.shipZone}
                </p>
              </div>

              <div className="space-y-2">
                {order.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-3">
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
                <Row label="Subtotal" value={formatBDT(order.subtotal)} />
                {order.discount > 0 && (
                  <Row label="Discount" value={`− ${formatBDT(order.discount)}`} />
                )}
                <Row
                  label="Delivery"
                  value={order.shippingFee === 0 ? "Free" : formatBDT(order.shippingFee)}
                />
                <div className="flex justify-between pt-1 text-base font-semibold text-primary">
                  <span>Total</span>
                  <span>{formatBDT(order.total)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 font-medium">Payment</p>
                <p className="capitalize text-muted-foreground">
                  {order.paymentMethod}
                  {order.payment ? ` · ${order.payment.status}` : ""}
                </p>
                {order.payment?.senderNumber && (
                  <p className="text-muted-foreground">Sender: {order.payment.senderNumber}</p>
                )}
                {order.payment?.trxId && (
                  <p className="text-muted-foreground">
                    TrxID:{" "}
                    <span className="font-medium text-foreground">{order.payment.trxId}</span>
                  </p>
                )}
                {order.payment?.rejectReason && (
                  <p className="text-destructive">Rejected: {order.payment.rejectReason}</p>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
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
