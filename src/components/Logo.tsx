import logo from "@/assets/nongorr-logo-transparent.webp";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  showName = true,
  variant = "default",
}: {
  className?: string;
  showName?: boolean;
  variant?: "default" | "light";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img
        src={logo}
        alt="Nongorr logo"
        width={40}
        height={40}
        className="h-9 w-9 object-contain"
      />
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
