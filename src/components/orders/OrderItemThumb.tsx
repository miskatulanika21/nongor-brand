import { useState } from "react";
import { PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Order line thumbnail that degrades gracefully: a missing OR broken image URL
 * reveals the packaged-item placeholder instead of a blank gap (order-workflow
 * #8). Shared by the order list, detail, track, and success surfaces so the
 * fallback is identical everywhere.
 */
export function OrderItemThumb({
  image,
  name,
  className,
}: {
  image: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box = cn("shrink-0 rounded object-cover", className);
  if (!image || failed) {
    return (
      <div
        className={cn("grid place-items-center rounded bg-muted text-muted-foreground", className)}
        aria-hidden="true"
      >
        <PackageOpen className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img src={image} alt={name} loading="lazy" onError={() => setFailed(true)} className={box} />
  );
}
