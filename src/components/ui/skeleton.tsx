import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Gold shimmer sweep over a faint maroon tint (brand skeleton), degrading to
  // a static tint under prefers-reduced-motion (see styles.css .shimmer guard).
  return <div className={cn("shimmer rounded-md bg-primary/10", className)} {...props} />;
}

export { Skeleton };
