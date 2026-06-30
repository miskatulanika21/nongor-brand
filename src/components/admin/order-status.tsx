/**
 * Shared presentation helpers for orders (admin board + order detail).
 *
 * Keeps the tone→class mapping and deterministic date formatting in ONE place so
 * the board and the detail sheet can never drift. orders-shared.ts stays UI-free
 * (no React/Tailwind); the visual mapping lives here instead.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_META,
  type OrderStatus,
  type PaymentStatus,
  type StatusTone,
} from "@/lib/orders-shared";

// Abstract status tone → brand badge classes (single mapping for all 6 tones).
export const TONE_BADGE: Record<StatusTone, string> = {
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
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Deterministic (UTC) date + time for the status-history timeline.
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)} · ${hh}:${mm} UTC`;
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(TONE_BADGE[meta.tone])}>
      {meta.label}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant="outline" className={cn("w-fit capitalize", PAYMENT_BADGE[status])}>
      {status}
    </Badge>
  );
}

/** Customer-facing status badge — uses the softer customerLabel + the same tone. */
export function CustomerStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(TONE_BADGE[meta.tone])}>
      {meta.customerLabel}
    </Badge>
  );
}
