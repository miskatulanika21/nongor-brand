import logo from "@/assets/nongorr-logo-transparent.webp";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  showName = true,
  variant = "default",
  roundMark = false,
}: {
  className?: string;
  showName?: boolean;
  variant?: "default" | "light";
  /** Sit the logo mark on a round white background — for dark surfaces (footer)
   *  where the transparent mark would otherwise blend into the background. */
  roundMark?: boolean;
}) {
  const mark = (
    <img
      src={logo}
      alt="Nongorr logo"
      width={40}
      height={40}
      className={cn("object-contain", roundMark ? "h-7 w-7" : "h-9 w-9")}
    />
  );

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {roundMark ? (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-background shadow-sm ring-1 ring-gold/20">
          {mark}
        </span>
      ) : (
        mark
      )}
      {showName && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-2xl font-semibold tracking-wide",
              variant === "light" ? "text-sidebar-foreground" : "text-primary",
            )}
          >
            Nongorr
          </span>
          <span
            className={cn(
              "text-[0.55rem] uppercase tracking-[0.3em]",
              variant === "light" ? "text-gold" : "text-muted-foreground",
            )}
          >
            Boutique
          </span>
        </span>
      )}
    </span>
  );
}
