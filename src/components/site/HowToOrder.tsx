import { SectionHeading } from "@/components/SectionHeading";
import { ShoppingBag, Ruler, Wallet, PackageCheck } from "lucide-react";

const STEPS = [
  {
    icon: ShoppingBag,
    step: "1",
    title: "Choose Your Product",
    desc: "Browse kurti, saree, three piece, girls dress and beauty, then pick your favourite.",
  },
  {
    icon: Ruler,
    step: "2",
    title: "Select Size or Custom Fit",
    desc: "Choose a ready size or share your measurements for a made-to-measure piece.",
  },
  {
    icon: Wallet,
    step: "3",
    title: "Pay Through bKash",
    desc: "Send payment to our bKash number and submit your TrxID — verified manually.",
  },
  {
    icon: PackageCheck,
    step: "4",
    title: "Confirmation & Delivery",
    desc: "We confirm your order, pack with care and deliver nationwide in 1–5 days.",
  },
];

export function HowToOrder() {
  return (
    <section>
      <SectionHeading
        eyebrow="Simple & Secure"
        title="How to Order"
        description="Four easy steps from boutique to your doorstep."
      />

      <div className="relative">
        {/* Desktop connector line behind the step badges */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent md:block"
        />

        <ol className="relative grid gap-6 md:grid-cols-4 md:gap-5">
          {STEPS.map((s, i) => (
            <li
              key={s.step}
              className="relative flex items-start gap-4 md:flex-col md:items-center md:text-center"
            >
              {/* Step badge with icon */}
              <div className="relative z-[1] flex shrink-0 flex-col items-center">
                {/* Mobile vertical rail connecting steps */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-14 h-[calc(100%-1rem)] w-px -translate-x-1/2 bg-gradient-to-b from-gold/40 to-transparent md:hidden"
                  />
                )}
                <div className="grid h-14 w-14 place-items-center rounded-full border border-gold/40 bg-card text-primary shadow-soft">
                  <s.icon className="h-6 w-6" />
                </div>
                <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-primary font-display text-sm font-semibold text-primary-foreground">
                  {s.step}
                </span>
              </div>

              <div className="md:mt-4">
                <h3 className="font-display text-2xl text-foreground">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
