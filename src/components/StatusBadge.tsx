import { cn } from "@/lib/utils";

/**
 * Premium status pill used across storefront + admin for order / payment states.
 * Maps a status string to a consistent maroon/gold/ivory tone.
 */
export type StatusTone = "neutral" | "info" | "warning" | "success" | "danger" | "gold";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
  warning: "border-gold/40 bg-gold/15 text-primary",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  gold: "border-gold/50 bg-gradient-gold text-gold-foreground",
};

// Central status → tone mapping. Keep in sync with backend order statuses later. TODO(backend)
const statusToneMap: Record<string, StatusTone> = {
  "new order": "info",
  "payment pending": "warning",
  "payment pending verification": "warning",
  pending: "warning",
  "payment verified": "success",
  verified: "success",
  confirmed: "info",
  processing: "info",
  "courier booked": "info",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "danger",
  rejected: "danger",
  returned: "warning",
  "refund pending": "warning",
  "refund done": "success",
};

export function statusTone(status: string): StatusTone {
  return statusToneMap[status.trim().toLowerCase()] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  className,
  dot = true,
}: {
  status: string;
  tone?: StatusTone;
  className?: string;
  dot?: boolean;
}) {
  const resolved = tone ?? statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[resolved],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {status}
    </span>
  );
}
