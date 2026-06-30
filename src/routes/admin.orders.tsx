import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { StatusBadge, PaymentBadge, fmtDate } from "@/components/admin/order-status";
import { OrderDetailSheet } from "@/components/admin/OrderDetailSheet";
import { listOrdersFn } from "@/lib/orders.api";
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  ORDER_LANES,
  ORDER_LANE_LABEL,
  isOrderStatus,
  type OrderStatus,
} from "@/lib/orders-shared";
import { formatBDT } from "@/lib/brand";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function OrdersAdmin() {
  const { orders, total, loadError } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
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
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => setActiveId(o.id)}>
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
                        {o.payment && <PaymentBadge status={o.payment.status} />}
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

      <OrderDetailSheet
        orderId={activeId}
        onClose={() => setActiveId(null)}
        onMutated={() => router.invalidate()}
      />
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
