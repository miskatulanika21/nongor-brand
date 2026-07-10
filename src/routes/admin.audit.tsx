import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminUI";
import { fmtDate } from "@/components/admin/order-status";
import { listAuditLogsFn } from "@/lib/audit.api";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_META,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABEL,
  auditActionLabel,
  auditActionTone,
  auditActorDisplay,
  isKnownAuditAction,
  type AuditLogRow,
  type AuditTone,
} from "@/lib/audit-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";

const PAGE_SIZE = 25;

const TONE_CLASS: Record<AuditTone, string> = {
  success: "bg-emerald-500/10 text-emerald-600",
  info: "bg-blue-500/10 text-blue-600",
  warning: "bg-amber-500/10 text-amber-700",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
};

interface AuditSearch {
  action?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** A YYYY-MM-DD date input → an ISO instant at the UTC day boundary. */
function dayStartIso(d?: string): string | undefined {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  return `${d}T00:00:00.000Z`;
}
/** End date is inclusive: use the start of the *next* day (RPC compares `< p_to`). */
function dayEndIso(d?: string): string | undefined {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
  const next = new Date(`${d}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit Logs · Nongorr Admin" }] }),
  validateSearch: (s: Record<string, unknown>): AuditSearch => {
    const action =
      typeof s.action === "string" && isKnownAuditAction(s.action) ? s.action : undefined;
    const q = typeof s.q === "string" && s.q.trim() ? s.q.trim().slice(0, 100) : undefined;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = typeof s.from === "string" && dateRe.test(s.from) ? s.from : undefined;
    const to = typeof s.to === "string" && dateRe.test(s.to) ? s.to : undefined;
    const pageNum = Number(s.page);
    const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
    return { action, q, from, to, page };
  },
  loaderDeps: ({ search }) => ({
    action: search.action,
    q: search.q,
    from: search.from,
    to: search.to,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const page = deps.page ?? 1;
    const res = await listAuditLogsFn({
      data: {
        action: deps.action,
        search: deps.q,
        from: dayStartIso(deps.from),
        to: dayEndIso(deps.to),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    });
    return { rows: res.rows, total: res.total, loadError: !res.success };
  },
  component: AuditAdmin,
});

function AuditAdmin() {
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
      navigate({ to: "/admin/audit", search: { ...search, q: next, page: 1 } });
    }, 350);
    return () => clearTimeout(id);
  }, [term, search, navigate]);

  const patch = (next: Partial<AuditSearch>) =>
    navigate({ to: "/admin/audit", search: { ...search, ...next, page: 1 } });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, totalPages);
  const goto = (p: number) =>
    navigate({
      to: "/admin/audit",
      search: { ...search, page: Math.min(Math.max(1, p), totalPages) },
    });

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const filtered = Boolean(search.action || search.q || search.from || search.to);

  return (
    <div>
      <AdminHeader
        title="Audit Logs"
        description="Every important action, tracked — who did what, and when."
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search action, target, actor email or details…"
            className="pl-9"
          />
        </div>
        <Select
          value={search.action ?? "all"}
          onValueChange={(v) => patch({ action: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="lg:w-[220px]">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {AUDIT_CATEGORIES.map((cat) => {
              const actions = AUDIT_ACTIONS.filter((a) => AUDIT_ACTION_META[a].category === cat);
              if (actions.length === 0) return null;
              return (
                <SelectGroup key={cat}>
                  <SelectLabel>{AUDIT_CATEGORY_LABEL[cat]}</SelectLabel>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIT_ACTION_META[a].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              );
            })}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label="From date"
          value={search.from ?? ""}
          max={search.to ?? undefined}
          onChange={(e) => patch({ from: e.target.value || undefined })}
          className="lg:w-[150px]"
        />
        <Input
          type="date"
          aria-label="To date"
          value={search.to ?? ""}
          min={search.from ?? undefined}
          onChange={(e) => patch({ to: e.target.value || undefined })}
          className="lg:w-[150px]"
        />
      </div>

      {loadError ? (
        <ErrorPanel onRetry={() => router.invalidate()} />
      ) : rows.length === 0 ? (
        <EmptyPanel filtered={filtered} />
      ) : (
        <>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {rows.map((row) => (
              <AuditRow key={row.id} row={row} />
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

function AuditRow({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const actor = auditActorDisplay(row);
  const tone = auditActionTone(row.action);
  const hasMeta = row.metadata && Object.keys(row.metadata).length > 0;

  return (
    <div className="flex items-start gap-4 p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold uppercase text-primary">
        {row.actorId ? actor.charAt(0) : "•"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
            title={row.action}
          >
            {auditActionLabel(row.action)}
          </span>
          <span className="text-sm font-medium text-foreground">{actor}</span>
          {row.actorRole && (
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {row.actorRole}
            </span>
          )}
        </div>
        {(row.targetType || row.targetId) && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {row.targetType ? `${row.targetType}: ` : ""}
            <span className="font-mono">{row.targetId ?? "—"}</span>
          </p>
        )}
        {hasMeta && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
            >
              {open ? "Hide details" : "Details"}
            </button>
            {open && (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary/60 p-3 text-xs text-foreground">
                {JSON.stringify(row.metadata, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground" title={row.createdAt}>
        {fmtDate(row.createdAt)}
      </span>
    </div>
  );
}

function EmptyPanel({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        <ScrollText className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">No audit entries</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered
          ? "No entries match the current filters. Try clearing the search, action or dates."
          : "Privileged actions across the admin will appear here as they happen."}
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
      <h3 className="font-display text-xl text-foreground">Could not load audit logs</h3>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong loading the trail. This page is owner-only — confirm you are signed in
        as the owner, then retry.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
