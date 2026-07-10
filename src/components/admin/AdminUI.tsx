import { cn } from "@/lib/utils";
import { Loader2, PackageOpen, AlertTriangle, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function AdminHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-display text-3xl text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  to,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  tone?: "default" | "primary" | "gold" | "success" | "destructive";
  to?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-secondary text-foreground",
    primary: "bg-primary/10 text-primary",
    gold: "bg-gold/15 text-primary",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/10 text-destructive",
  };
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", tones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 font-display text-3xl text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const base =
    "block rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-soft";
  if (to) {
    return (
      <Link to={to as never} className={cn(base, "hover:border-primary/40")}>
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

/* ------------------------------------------------------------------ */
/* Phase 10 mock-preview primitives                                    */
/* ------------------------------------------------------------------ */

export type AdminPreviewState = "loaded" | "loading" | "empty" | "error";

/** Small honest chip — marks UI that is not persisted anywhere. */
export function MockBadge({
  label = "Local preview",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-primary",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Standard line shown on every editable route. */
export function PreviewNotice({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <p className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", className)}>
      <MockBadge />
      <span>{children ?? "Local preview only · Changes reset when this page reloads."}</span>
    </p>
  );
}

export function AdminSectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            {title && <h2 className="font-display text-xl text-foreground">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function AdminLoadingState({
  label = "Loading preview",
  rows = 4,
  className,
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-gold" />
        {label}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="admin-preview-shimmer h-12 rounded-lg border border-border bg-secondary"
        />
      ))}
    </div>
  );
}

export function AdminEmptyState({
  title = "No preview records",
  description = "This is a simulated empty state.",
  icon,
  action,
  className,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        {icon ?? <PackageOpen className="h-6 w-6" />}
      </div>
      <h3 className="font-display text-xl text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <MockBadge label="Simulated state" />
      {action}
    </div>
  );
}

export function AdminErrorState({
  title = "Preview unavailable",
  description = "This is a simulated UI state.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="font-display text-xl text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <MockBadge label="Simulated state" />
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Retry (resets to loaded)
        </Button>
      )}
    </div>
  );
}

const PREVIEW_STATES: { value: AdminPreviewState; label: string }[] = [
  { value: "loaded", label: "Loaded" },
  { value: "loading", label: "Loading" },
  { value: "empty", label: "Empty" },
  { value: "error", label: "Error" },
];

/** Visual-QA control to preview mock states. Not a business filter. */
export function AdminStateToggle({
  value,
  onValueChange,
}: {
  value: AdminPreviewState;
  onValueChange: (v: AdminPreviewState) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        Preview state
      </span>
      <div
        role="group"
        aria-label="Preview state"
        className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {PREVIEW_STATES.map((s) => {
          const active = s.value === value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={active}
              onClick={() => onValueChange(s.value)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm transition-colors",
                active
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface ViewOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/** Accessible segmented view switcher with selected states. */
export function ViewToggle<T extends string>({
  value,
  onValueChange,
  options,
  label = "View",
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: ViewOption<T>[];
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex gap-1 rounded-lg border border-border bg-card p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.label}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Coming soon" placeholder for a not-yet-built admin screen. Replaces mock/demo
 * page bodies so an operator can never mistake simulated data for real data. The
 * route stays permission-guarded; the nav link is hidden (see admin-routes).
 */
export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div>
      <AdminHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-20 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-gold/15 text-primary">
          {icon ?? <PackageOpen className="h-7 w-7" />}
        </div>
        <span className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-primary">
          Coming soon
        </span>
        <h2 className="font-display text-2xl text-foreground">Not available yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {description ??
            "This screen isn't built yet. It's parked here so nothing shows fake data — it will light up in a later stage."}
        </p>
      </div>
    </div>
  );
}

/** Helper used across routes for temporary local-only record IDs. */
export function createPreviewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `preview-${crypto.randomUUID()}`;
  }
  return `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
