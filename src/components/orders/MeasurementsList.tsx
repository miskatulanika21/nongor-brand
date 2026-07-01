import { Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomMeasurements } from "@/lib/orders-shared";

/**
 * Renders the made-to-measure measurements captured at checkout for a custom
 * line. Shared by the admin order detail (workshop visibility), the customer's
 * own order detail, and guest tracking. Renders nothing when there are none.
 */
export function MeasurementsList({
  measurements,
  className,
}: {
  measurements: CustomMeasurements | null | undefined;
  className?: string;
}) {
  const entries = measurements ? Object.entries(measurements) : [];
  if (entries.length === 0) return null;

  return (
    <div className={cn("rounded-lg border border-gold/30 bg-gold/5 p-3", className)}>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Ruler className="h-3.5 w-3.5 text-gold" /> Custom measurements
      </p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {entries.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
