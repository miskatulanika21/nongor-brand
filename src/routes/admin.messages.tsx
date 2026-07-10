import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminHeader } from "@/components/admin/AdminUI";
import { fmtDate } from "@/components/admin/order-status";
import { listContactMessagesFn, setContactMessageStatusFn } from "@/lib/contact.api";
import {
  CONTACT_STATUS_META,
  isContactStatus,
  type ContactMessageRow,
  type ContactStatus,
} from "@/lib/contact-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MessageCircle,
  Search,
} from "lucide-react";

const PAGE_SIZE = 25;

const TONE_CLASS: Record<string, string> = {
  amber: "bg-amber-500/10 text-amber-700",
  green: "bg-emerald-500/10 text-emerald-600",
  slate: "bg-secondary text-muted-foreground",
};

interface MessagesSearch {
  status?: ContactStatus;
  q?: string;
  page?: number;
}

export const Route = createFileRoute("/admin/messages")({
  head: () => ({ meta: [{ title: "Messages · Nongorr Admin" }] }),
  validateSearch: (s: Record<string, unknown>): MessagesSearch => {
    const status = typeof s.status === "string" && isContactStatus(s.status) ? s.status : undefined;
    const q = typeof s.q === "string" && s.q.trim() ? s.q.trim().slice(0, 100) : undefined;
    const pageNum = Number(s.page);
    const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
    return { status, q, page };
  },
  loaderDeps: ({ search }) => ({ status: search.status, q: search.q, page: search.page }),
  loader: async ({ deps }) => {
    const page = deps.page ?? 1;
    const res = await listContactMessagesFn({
      data: {
        status: deps.status,
        search: deps.q,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    });
    return { rows: res.rows, total: res.total, loadError: !res.success };
  },
  component: MessagesAdmin,
});

function MessagesAdmin() {
  const { rows, total, loadError } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [term, setTerm] = useState(search.q ?? "");

  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    const next = term.trim() || undefined;
    if (next === (search.q ?? undefined)) return;
    const id = setTimeout(() => {
      navigate({ to: "/admin/messages", search: { status: search.status, q: next, page: 1 } });
    }, 350);
    return () => clearTimeout(id);
  }, [term, search.q, search.status, navigate]);

  const setStatus = (status: ContactStatus | undefined) =>
    navigate({ to: "/admin/messages", search: { status, q: search.q, page: 1 } });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, totalPages);
  const goto = (p: number) =>
    navigate({
      to: "/admin/messages",
      search: { status: search.status, q: search.q, page: Math.min(Math.max(1, p), totalPages) },
    });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <AdminHeader
        title="Messages"
        description="Customer messages from the storefront contact form."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search name, phone, order no or message…"
            className="pl-9"
          />
        </div>
        <Select
          value={search.status ?? "all"}
          onValueChange={(v) => setStatus(v === "all" ? undefined : (v as ContactStatus))}
        >
          <SelectTrigger className="sm:w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="handled">Handled</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loadError ? (
        <ErrorPanel onRetry={() => router.invalidate()} />
      ) : rows.length === 0 ? (
        <EmptyPanel filtered={Boolean(search.status || search.q)} />
      ) : (
        <>
          <div className="space-y-3">
            {rows.map((row) => (
              <MessageCard key={row.id} row={row} onMutated={() => router.invalidate()} />
            ))}
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
    </div>
  );
}

function MessageCard({ row, onMutated }: { row: ContactMessageRow; onMutated: () => void }) {
  const [busy, setBusy] = useState(false);
  const meta = CONTACT_STATUS_META[row.status];
  const waHref = `https://wa.me/88${row.phone.replace(/\D/g, "").replace(/^88/, "")}`;

  async function changeStatus(status: ContactStatus) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await setContactMessageStatusFn({ data: { id: row.id, status } });
      if (res.success) {
        toast.success(`Marked ${CONTACT_STATUS_META[status].label.toLowerCase()}`);
        onMutated();
      } else {
        toast.error(res.error ?? "Could not update the message.");
      }
    } catch {
      toast.error("Could not update the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{row.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[meta.tone]}`}
            >
              {meta.label}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {row.reason}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.phone}
            {row.email ? ` · ${row.email}` : ""}
            {row.orderNumber ? ` · Order ${row.orderNumber}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground" title={row.createdAt}>
          {fmtDate(row.createdAt)}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{row.message}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href={waHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Reply on WhatsApp
          </a>
        </Button>
        {row.status !== "handled" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => changeStatus("handled")}
          >
            Mark handled
          </Button>
        )}
        {row.status !== "new" && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => changeStatus("new")}>
            Reopen
          </Button>
        )}
        {row.status !== "archived" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => changeStatus("archived")}
          >
            Archive
          </Button>
        )}
        {row.handledByEmail && row.status !== "new" && (
          <span className="ml-auto text-xs text-muted-foreground">by {row.handledByEmail}</span>
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        <Inbox className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">No messages</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "No messages match the current filters."
          : "Customer messages from the contact form will appear here."}
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
      <h3 className="font-display text-xl text-foreground">Could not load messages</h3>
      <p className="max-w-sm text-sm text-muted-foreground">Something went wrong. Please retry.</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
