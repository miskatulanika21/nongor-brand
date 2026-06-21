const ITEMS = [
  "Free Delivery Over ৳3000",
  "100% Authentic Products",
  "Handcrafted with Love",
  "Easy Returns",
  "Pay via bKash",
  "WhatsApp Support",
];

export function TrustMarquee() {
  // Duplicate the list so the -50% translate loops seamlessly.
  const loop = [...ITEMS, ...ITEMS];
  return (
    <div className="overflow-hidden border-y border-gold/30 bg-gradient-hero py-3">
      <div className="marquee-track flex w-max animate-marquee items-center whitespace-nowrap">
        {loop.map((t, i) => (
          <span key={i} className="flex items-center">
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
