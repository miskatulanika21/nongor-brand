import { cn } from "@/lib/utils";

/**
 * PremiumCard — the canonical Nongorr surface: ivory card, soft border,
 * elegant shadow, optional gold accent + hover lift. Use for any boxed content
 * so every page shares one consistent boutique card style.
 */
export function PremiumCard({
  children,
  className,
  hover = false,
  accent = false,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  accent?: boolean;
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border bg-card p-5 shadow-soft transition-all duration-300",
        accent ? "border-gold/40" : "border-border",
        hover && "hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
