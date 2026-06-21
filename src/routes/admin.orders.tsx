import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { ORDERS, ORDER_PIPELINE, STATUS_TONE, type Order, type OrderStatus } from "@/lib/orders";
import { formatBDT } from "@/lib/brand";
import {
  buildWaMessage,
  DATE_RANGES,
  inRange,
  printInvoice,
  waLink,
  WA_TEMPLATES,
  type DateRange,
} from "@/lib/admin-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Search, Printer, MessageCircle, ImageIcon, Ruler } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/orders")({
  component: OrdersAdmin,
});

const ALL_STATUSES: OrderStatus[] = [
  "New Order",
  "Payment Pending",
  "Payment Verified",
  "Confirmed",
  "Processing",
  "Courier Booked",
  "Shipped",
  "Delivered",
  "Completed",
  "Cancelled",
  "Returned",
  "Refund Pending",
  "Refund Done",
];

// Extended mock dataset so every status/filter has something to show.
const sampleOrders: Order[] = [
  ...ORDERS,
  {
    ...ORDERS[0],
    id: "NGR-100260",
    date: "2026-06-14",
    status: "New Order",
    customer: "Mim Chowdhury",
    paymentStatus: "Pending",
    note: "Wants delivery before Eid.",
  },
  {
    ...ORDERS[2],
    id: "NGR-100261",
    date: "2026-06-14",
    status: "Confirmed",
    customer: "Lamia Haque",
  },
  {
    ...ORDERS[1],
    id: "NGR-100262",
    date: "2026-06-10",
    status: "Processing",
    customer: "Sadia Islam",
    measurements: "Bust 36, Waist 30, Length 42",
  } as Order,
  {
    ...ORDERS[0],
    id: "NGR-100258",
    date: "2026-06-02",
    status: "Completed",
    customer: "Farzana Yasmin",
  },
  {
    ...ORDERS[1],
    id: "NGR-100240",
    date: "2026-05-22",
    status: "Refund Pending",
    customer: "Tania Rahman",
    paymentStatus: "Verified",
  },
];

function OrdersAdmin() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [range, setRange] = useState<DateRange>("all");
  const [active, setActive] = useState<Order | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    sampleOrders.forEach((o) => (c[o.status] = (c[o.status] ?? 0) + 1));
    return c;
  }, []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sampleOrders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!inRange(o.date, range)) return false;
      if (!q) return true;
      return (
        o.customer.toLowerCase().includes(q) ||
        o.phone.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
      );
    });
  }, [query, status, range]);

  return (
    <div>
      <AdminHeader
        title="Orders"
        description="Search, filter and manage your order pipeline end to end."
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or order ID…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {DATE_RANGES.map((r) => (
            <Chip
              key={r.key}
              active={range === r.key}
              onClick={() => setRange(r.key)}
              label={r.label}
            />
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Chip
          active={status === "all"}
          onClick={() => setStatus("all")}
          label={`All (${sampleOrders.length})`}
        />
        {ALL_STATUSES.map((s) => (
          <Chip
            key={s}
            active={status === s}
            onClick={() => setStatus(s)}
            label={`${s}${counts[s] ? ` (${counts[s]})` : ""}`}
          />
        ))}
      </div>

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
            {list.map((o) => (
              <TableRow key={o.id} className="cursor-pointer" onClick={() => setActive(o)}>
                <TableCell>
                  <p className="font-medium text-foreground">{o.id}</p>
                  <p className="text-xs text-muted-foreground">{o.date}</p>
                </TableCell>
                <TableCell>
                  <p className="text-foreground">{o.customer}</p>
                  <p className="text-xs text-muted-foreground">{o.phone}</p>
                </TableCell>
                <TableCell className="font-medium text-primary">{formatBDT(o.total)}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      o.paymentStatus === "Verified"
                        ? "border-success/40 text-success"
                        : o.paymentStatus === "Rejected"
                          ? "border-destructive/40 text-destructive"
                          : "border-gold/40 text-primary",
                    )}
                  >
                    {o.paymentStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(STATUS_TONE[o.status] ?? "")}>
                    {o.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No orders match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <OrderSheet order={active} onClose={() => setActive(null)} />
    </div>
  );
}

function OrderSheet({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <Sheet open={!!order} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-2xl">{order.id}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              {/* Customer */}
              <div className="rounded-lg bg-secondary p-3">
                <p className="font-medium text-foreground">{order.customer}</p>
                <p className="text-muted-foreground">{order.phone}</p>
                <p className="text-muted-foreground">
                  {order.address}, {order.district}
                </p>
              </div>

              {/* Items */}
              <div className="space-y-2">
                {order.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <img src={it.image} alt="" className="h-12 w-10 rounded object-cover" />
                    <div className="flex-1">
                      <p className="line-clamp-1 text-foreground">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty {it.qty}
                        {it.size ? ` · ${it.size}` : ""}
                      </p>
                    </div>
                    <span className="font-medium">{formatBDT(it.price * it.qty)}</span>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-1">
                <Row label="Subtotal" value={formatBDT(order.subtotal)} />
                <Row
                  label="Delivery"
                  value={order.shipping === 0 ? "Free" : formatBDT(order.shipping)}
                />
                <div className="flex justify-between pt-1 text-base font-semibold text-primary">
                  <span>Total</span>
                  <span>{formatBDT(order.total)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 font-medium">Payment</p>
                <p className="text-muted-foreground">
                  {order.paymentMethod} · {order.paymentStatus}
                </p>
                <p className="text-muted-foreground">Sender bKash: {order.senderNumber}</p>
                <p className="text-muted-foreground">
                  TrxID: <span className="font-medium text-foreground">{order.trxId}</span>
                </p>
                <div className="mt-2 grid h-28 place-items-center rounded-md border border-dashed border-border bg-secondary text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="h-4 w-4" /> Payment screenshot preview
                  </span>
                </div>
              </div>

              {/* Custom measurements */}
              {(order as Order & { measurements?: string }).measurements && (
                <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-primary">
                    <Ruler className="h-4 w-4" /> Custom measurements
                  </p>
                  <p className="text-muted-foreground">
                    {(order as Order & { measurements?: string }).measurements}
                  </p>
                </div>
              )}

              {/* Admin note */}
              <div className="space-y-1.5">
                <p className="font-medium">Admin note</p>
                <Textarea
                  defaultValue={order.note}
                  placeholder="Internal note (not visible to customer)…"
                />
              </div>

              {/* Status update */}
              <div className="space-y-1.5">
                <p className="font-medium">Update status</p>
                <Select
                  defaultValue={order.status}
                  onValueChange={() => toast.success("Status updated (demo)")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_PIPELINE.concat([
                      "Cancelled",
                      "Returned",
                      "Refund Pending",
                      "Refund Done",
                    ] as OrderStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* WhatsApp templates */}
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 font-medium">
                  <MessageCircle className="h-4 w-4 text-success" /> WhatsApp templates
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {WA_TEMPLATES.map((t) => (
                    <Button
                      key={t.key}
                      variant="outline"
                      size="sm"
                      asChild
                      className="justify-start"
                    >
                      <a
                        href={waLink(order.phone, buildWaMessage(t.key, order))}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.label}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" onClick={() => toast.success("Order confirmed (demo)")}>
                  Confirm
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => printInvoice(order)}>
                  <Printer className="h-4 w-4" /> Print invoice
                </Button>
              </div>
              {/* TODO: persist status, note and notifications via backend */}
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

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary",
      )}
    >
      {label}
    </button>
  );
}
