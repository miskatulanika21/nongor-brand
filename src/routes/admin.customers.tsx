import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { fmtDate } from "@/components/admin/order-status";
import { listCustomersFn } from "@/lib/customers.api";
import { customerTags, type AdminCustomer, type CustomerTag } from "@/lib/customers-shared";
import { formatBDT } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Package,
  Search,
  UsersRound,
} from "lucide-react";

// Page size — must match the loader's `limit` so pagination math is correct.
const PAGE_SIZE = 20;

interface CustomersSearch {
  q?: string;
  page?: number;
}

export const Route = createFileRoute("/admin/customers")({
  head: () => ({ meta: [{ title: "Customers · Nongorr Admin" }] }),
  // URL is the source of truth for filters — same board pattern as /admin/orders.
  validateSearch: (s: Record<string, unknown>): CustomersSearch => {
    const q = typeof s.q === "string" && s.q.trim() ? s.q.trim().slice(0, 100) : undefined;
    const pageNum = Number(s.page);
    const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
    return { q, page };
  },
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page }),
  loader: async ({ deps }) => {
    const page = deps.page ?? 1;
    const res = await listCustomersFn({
      data: { search: deps.q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    });
    return { customers: res.customers, total: res.total, loadError: !res.success };
  },
  component: Customers,
});

const TAG_TONE: Record<CustomerTag, string> = {
  VIP: "border-gold/50 text-primary bg-gold/10",
  "Repeat Customer": "border-success/40 text-success",
  "High Risk": "border-destructive/40 text-destructive",
  "Custom Size": "border-primary/30 text-primary",
};

function TagBadges({ customer }: { customer: AdminCustomer }) {
  const tags = customerTags(customer);
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="outline" className={TAG_TONE[t]}>
          {t}
        </Badge>
      ))}
    </div>
  );
}

function Customers() {
  const { customers, total, loadError } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [active, setActive] = useState<AdminCustomer | null>(null);
  const [term, setTerm] = useState(search.q ?? "");

  // Keep the input in sync when the URL changes elsewhere (back/forward, reset).
  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  // Debounce the search box → push `q` into the URL (resetting to page 1).
  useEffect(() => {
    const next = term.trim() || undefined;
    if (next === (search.q ?? undefined)) return;
    const id = setTimeout(() => {
      navigate({ to: "/admin/customers", search: { q: next, page: 1 } });
    }, 350);
    return () => clearTimeout(id);
  }, [term, search.q, navigate]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, totalPages);
  const goto = (p: number) =>
    navigate({
      to: "/admin/customers",
      search: { q: search.q, page: Math.min(Math.max(1, p), totalPages) },
    });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <AdminHeader
        title="Customers"
        description="Every account with its live order history — search by name, phone or email."
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name, phone or email…"
          className="pl-9"
        />
      </div>

      {loadError ? (
        <ErrorPanel onRetry={() => router.invalidate()} />
      ) : customers.length === 0 ? (
        <EmptyPanel filtered={Boolean(search.q)} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Spent</TableHead>
                  <TableHead>Last order</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.userId} className="cursor-pointer" onClick={() => setActive(c)}>
                    <TableCell>
                      <p className="font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.phone ?? c.email ?? "—"}</p>
                    </TableCell>
                    <TableCell>{c.ordersCount}</TableCell>
                    <TableCell className="font-medium text-primary">
                      {formatBDT(c.lifetimeSpent)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.lastOrderAt ? fmtDate(c.lastOrderAt) : "Never"}
                    </TableCell>
                    <TableCell>
                      <TagBadges customer={c} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        View
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

      <Sheet open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {active && <CustomerSheet customer={active} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CustomerSheet({ customer }: { customer: AdminCustomer }) {
  // The admin orders board searches order_no / customer name / phone — phone is
  // the strongest key for "this customer's orders", falling back to the name.
  const ordersQuery = customer.phone ?? customer.name;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-display text-2xl">{customer.name}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-4 text-sm">
        <div className="space-y-1 rounded-lg bg-secondary p-3">
          {customer.phone && <p className="text-muted-foreground">{customer.phone}</p>}
          {customer.email && <p className="break-all text-muted-foreground">{customer.email}</p>}
          <p className="text-xs text-muted-foreground">Joined {fmtDate(customer.joinedAt)}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Orders" value={customer.ordersCount} />
          <Stat label="Spent" value={formatBDT(customer.lifetimeSpent)} />
          <Stat label="Returns" value={customer.returnsCount} />
        </div>
        {customer.lastOrderAt && (
          <p className="text-xs text-muted-foreground">
            Last order {fmtDate(customer.lastOrderAt)}
          </p>
        )}
        <div>
          <p className="mb-2 font-medium">Tags</p>
          <TagBadges customer={customer} />
        </div>
        {customer.ordersCount > 0 && (
          <Button className="w-full" variant="outline" asChild>
            <Link to="/admin/orders" search={{ q: ordersQuery, page: 1 }}>
              <Package className="h-4 w-4" /> View orders on the board
            </Link>
          </Button>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="font-display text-xl text-primary">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function EmptyPanel({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        <UsersRound className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">No customers found</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "No customers match this search. Try a different name, phone or email."
          : "Customers will appear here as soon as shoppers create accounts."}
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
      <h3 className="font-display text-xl text-foreground">Could not load customers</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong loading the customer directory. Please retry.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
