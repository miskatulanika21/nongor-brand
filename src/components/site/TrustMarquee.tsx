import { formatBDT } from "@/lib/brand";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/checkout-ui";

const STATIC_ITEMS = [
  "100% Authentic Products",
  "Handcrafted with Love",
  "Easy Returns",
  "Pay via bKash",
  "WhatsApp Support",
];

export function TrustMarquee({ freeDeliveryThreshold }: { freeDeliveryThreshold?: number }) {
  // The threshold comes from admin settings so the banner can never promise a
  // different number than checkout charges.
  const items = [
    `Free Delivery Over ${formatBDT(freeDeliveryThreshold ?? FREE_DELIVERY_THRESHOLD)}`,
    ...STATIC_ITEMS,
  ];
  // Duplicate the list so the -50% translate loops seamlessly; the copy is
  // hidden from assistive tech so screen readers hear each claim once.
  const loop = [...items, ...items];
  return (
    <div className="overflow-hidden border-y border-gold/30 bg-gradient-hero py-3">
      <div className="marquee-track flex w-max animate-marquee items-center whitespace-nowrap">
        {loop.map((t, i) => (
          <span key={i} className="flex items-center" aria-hidden={i >= items.length || undefined}>
            <span className="px-6 text-sm font-medium tracking-wide text-primary-foreground/90 sm:px-8">
              {t}
            </span>
            <span aria-hidden className="text-gold">
              ✦
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
