import { cn } from "@/lib/utils";
import logo from "@/assets/nongorr-logo-transparent.webp";

/**
 * BrandLoader — the house loading mark: an antique-gold comet arc orbiting the
 * Nongorr logo, over a faint gold track ring. Reads unmistakably as the brand
 * where a generic spinner would feel off (route transitions, full-block data
 * loads). Motion is a single restrained rotation; reduced-motion viewers get a
 * static ring (handled in styles.css). In-button loading keeps the plain lucide
 * spinner — this mark is for larger, centered contexts only.
 */
const SIZES = {
  sm: { box: "h-7 w-7", ringW: "2.5px", logo: "h-3.5 w-3.5" },
  md: { box: "h-12 w-12", ringW: "3px", logo: "h-6 w-6" },
  lg: { box: "h-20 w-20", ringW: "3.5px", logo: "h-11 w-11" },
} as const;

export function BrandLoader({
  size = "md",
  label,
  className,
}: {
  size?: keyof typeof SIZES;
  /** Optional caption below the mark (rendered in the display face). */
  label?: string;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("animate-scale-in flex flex-col items-center justify-center gap-3", className)}
    >
      <div className={cn("relative grid place-items-center", s.box)}>
        {/* Faint full track so the comet reads as an orbit, not a fragment. */}
        <span className="absolute inset-0 rounded-full border border-gold/20" aria-hidden="true" />
        {/* Rotating gold comet arc. */}
        <span
          className="nongorr-ring absolute inset-0"
          style={{ ["--ring-w" as string]: s.ringW }}
          aria-hidden="true"
        />
        {/* Brand logo, centered inside the ring. */}
        <img src={logo} alt="" aria-hidden="true" className={cn("object-contain", s.logo)} />
      </div>
      {label && (
        <p className="font-display text-sm tracking-[0.08em] text-muted-foreground">{label}</p>
      )}
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
