import { cn } from "@/lib/utils";
import { PackageOpen, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/BrandLoader";

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center py-16", className)}>
      <BrandLoader size="md" label={label} />
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  icon,
  action,
  primaryAction,
  secondaryAction,
  className,
}: {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  /** Backward-compatible custom action node. */
  action?: React.ReactNode;
  /** Preferred: primary CTA rendered with full button hierarchy. */
  primaryAction?: React.ReactNode;
  /** Optional supporting CTA shown next to the primary one. */
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  const hasCtas = action || primaryAction || secondaryAction;
  return (
    <div
      className={cn(
        "animate-fade-in flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center",
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary">
        {icon ?? <PackageOpen className="h-6 w-6" />}
      </div>
      <h3 className="font-display text-xl text-foreground">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {hasCtas && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {primaryAction}
          {secondaryAction}
          {action}
        </div>
      )}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Please try again in a moment.",
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
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function SuccessState({
  title = "Success",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-success/30 bg-success/5 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h3 className="font-display text-2xl text-foreground">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
