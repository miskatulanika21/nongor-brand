import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Phase 1 — consistent inline form messaging.
 * Pair with Input/Textarea (which expose aria-invalid + data-success states)
 * and Label `required`. Presentation only; no form logic.
 */

export function FormHelperText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>;
}

export function FormError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("flex items-center gap-1.5 text-xs text-destructive", className)}>
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

export function FormSuccess({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-success", className)}>
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}
