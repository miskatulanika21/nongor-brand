import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { BRAND } from "@/lib/brand";
import logo from "@/assets/nongorr-logo-transparent.png";
import {
  Search,
  Sparkles,
  Ruler,
  ShieldCheck,
  Truck,
  MessageCircle,
  Headphones,
  RefreshCw,
  HandHeart,
  Star,
  Lock,
  Heart,
  X,
} from "lucide-react";

type Faq = { q: string; a: string; category: string; popular?: boolean };

export const FAQS: Faq[] = [
  // Ordering
  {
    category: "Ordering",
    popular: true,
    q: "How can I place an order?",
    a: "You can place an order directly from our website by selecting your product, choosing size or custom size if available, adding it to cart, and completing checkout with your delivery information.",
  },
  {
    category: "Ordering",
    q: "Can I order through WhatsApp or Messenger?",
    a: "Yes. If you need help before placing an order, you can contact us through WhatsApp or Messenger. Our team will guide you with product details, size selection, and order confirmation.",
  },
  {
    category: "Ordering",
    q: "Can I change my order after placing it?",
    a: "If your order has not started processing, we may be able to update your size, address, or phone number. Please contact us as soon as possible with your order details.",
  },
  {
    category: "Ordering",
    q: "How do I know my order is confirmed?",
    a: "After placing an order, you will receive an order confirmation on the website and/or through our support channel. For manual payment orders, confirmation may happen after payment verification.",
  },
  // Payment
  {
    category: "Payment",
    popular: true,
    q: "What payment methods do you accept?",
    a: "The current checkout uses manual bKash payment. Enter the correct TrxID so the payment can be reviewed before order confirmation.",
  },
  {
    category: "Payment",
    q: "Do I need to provide a transaction ID?",
    a: "Yes. For manual bKash payment, please provide the correct TrxID (transaction ID) during checkout so your payment can be reviewed before order confirmation.",
  },
  {
    category: "Payment",
    q: "Is my payment safe?",
    a: "Pay only to the Nongorr payment number shown during checkout and keep the TrxID for manual verification.",
  },
  // Delivery
  {
    category: "Delivery",
    popular: true,
    q: "Do you deliver all over Bangladesh?",
    a: "Yes. We deliver inside Dhaka and outside Dhaka through courier partners, depending on service availability.",
  },
  {
    category: "Delivery",
    q: "How long does delivery take?",
    a: "Delivery time depends on destination, product preparation and courier availability. See the Delivery Policy for the current estimates.",
  },
  {
    category: "Delivery",
    q: "How much is the delivery charge?",
    a: "The delivery charge depends on your location and is shown during checkout. The current rates and free-delivery threshold are listed in the Delivery Policy.",
  },
  {
    category: "Delivery",
    q: "Can I track my order?",
    a: "Courier and tracking information will be shared when the parcel is assigned and booked.",
  },
  // Custom Size
  {
    category: "Custom Size",
    popular: true,
    q: "Do you offer custom size?",
    a: "Yes. For selected handmade clothing items, especially kurtis, we offer custom size options so the product can be made according to your body measurements.",
  },
  {
    category: "Custom Size",
    q: "Which measurements do I need for custom size?",
    a: "Usually we need bust, waist, hip, shoulder, sleeve length, and dress length. Please follow our \u201CHow to Measure\u201D guide carefully before submitting measurements.",
  },
  {
    category: "Custom Size",
    q: "Is there an extra charge for custom size?",
    a: "Some custom-size orders may include an additional making charge depending on the product, design, and measurement requirements. The charge will be shown before checkout when applicable.",
  },
  {
    category: "Custom Size",
    q: "Can I return a custom-size product?",
    a: "Custom-size products are made specially for you, so they are usually not returnable unless there is a clear defect, wrong product, or major issue from our side.",
  },
  // Returns & Exchange
  {
    category: "Returns & Exchange",
    q: "What is your return policy?",
    a: "We accept return or exchange requests only for eligible cases such as wrong item, damaged item, size issue from our side, or verified product defect. The request must be made within the allowed time after delivery.",
  },
  {
    category: "Returns & Exchange",
    q: "What items are not returnable?",
    a: "Used products, washed products, damaged-by-customer products, custom-size items, and personal care/cosmetic items may not be returnable unless there is a verified issue from our side.",
  },
  {
    category: "Returns & Exchange",
    q: "How can I request an exchange?",
    a: "Contact our support team with your order number, clear photos/videos of the issue, and your explanation. Our team will review and guide you through the next steps.",
  },
  // Cosmetics Authenticity
  {
    category: "Cosmetics Authenticity",
    q: "How does Nongorr check cosmetics before dispatch?",
    a: "We aim to review available supplier information, packaging condition, batch details and expiry information before dispatch. The information available can vary by product and supplier.",
  },
  {
    category: "Cosmetics Authenticity",
    q: "What should I do if I have an authenticity concern?",
    a: "Do not use the product. Keep the packaging, batch information and invoice or order ID, then contact Nongorr with clear photos so the concern can be reviewed.",
  },
  // Account
  {
    category: "Account",
    q: "Do I need an account to order?",
    a: "Guest checkout is available. The current Account area is a browser-local UI preview for saved addresses, measurements and device orders; authentication and cross-device sync are not connected yet.",
  },
  // Support
  {
    category: "Support",
    q: "How can I contact Nongorr?",
    a: "You can contact us through WhatsApp, Messenger, or the contact options shown on our website. We usually respond when support is available.",
  },
  {
    category: "Support",
    q: "I am confused about size. What should I do?",
    a: "Please check our size guide first. If you are still unsure, contact us with your height, weight, usual size, and preferred fit. We will help you choose the best option.",
  },
];

const CATEGORIES = [
  "All",
  "Ordering",
  "Payment",
  "Delivery",
  "Custom Size",
  "Returns & Exchange",
  "Cosmetics Authenticity",
  "Account",
  "Support",
];

const trustRow = [
  { icon: HandHeart, label: "Handmade with care" },
  { icon: Ruler, label: "Custom size available" },
  { icon: ShieldCheck, label: "Secure order support" },
  { icon: Truck, label: "Bangladesh delivery" },
];

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hi Nongorr! I have a question and need some help 💕",
)}`;

export const Route = createFileRoute("/_site/faq")({
  head: () => ({
    meta: [
      { title: "FAQ | Nongorr Studio" },
      {
        name: "description",
        content:
          "Nongorr FAQ: ordering, payment, delivery, custom size, returns & exchange, cosmetics authenticity, account and support.",
      },
      { property: "og:title", content: "FAQ | Nongorr Studio" },
      {
        property: "og:description",
        content:
          "Answers on ordering, payment, delivery, custom size, returns & exchange, cosmetics authenticity, account and support.",
      },
      { property: "og:url", content: "/faq" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: FAQ,
});

function FAQ() {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((f) => {
      const matchesCat = activeCat === "All" || f.category === activeCat;
      const matchesQuery = !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [query, activeCat]);

  const popular = FAQS.filter((f) => f.popular);

  return (
    <div className="overflow-hidden">
      {/* HERO */}
      <section className="relative isolate border-b border-border bg-secondary/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: "var(--gradient-gold)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full opacity-20 blur-3xl"
          style={{ background: "var(--gradient-hero)" }}
        />
        <img
          aria-hidden
          src={logo}
          alt=""
          className="pointer-events-none absolute -right-10 top-1/2 hidden w-72 -translate-y-1/2 opacity-[0.06] sm:block"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="eyebrow">Help Centre</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-5xl md:text-6xl">
            Questions? We&apos;re here to help.
          </h1>
          <p className="mt-2 font-display text-xl text-gold-foreground/80">
            আপনার সাধারণ প্রশ্নের উত্তর
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Find answers about orders, custom sizing, delivery, payment, returns, and product care.
          </p>
          <div className="ornament-divider mx-auto mt-6 w-40" />
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {trustRow.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5">
                <Icon className="size-3.5 text-gold-foreground" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-10">
          {/* MAIN */}
          <div>
            {/* SEARCH */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your question…"
                aria-label="Search FAQ"
                className="h-12 rounded-full border-border bg-card pl-11 pr-10 shadow-[var(--shadow-soft)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* CATEGORY CHIPS */}
            <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCat(cat)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ${
                    activeCat === cat
                      ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-soft)]"
                      : "border-border bg-card text-muted-foreground hover:border-gold/40 hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* POPULAR */}
            {activeCat === "All" && !query && (
              <div className="mt-9">
                <h2 className="flex items-center gap-2 font-display text-2xl text-foreground">
                  <Star className="size-5 text-gold-foreground" /> Popular Questions
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {popular.map((f) => (
                    <button
                      key={f.q}
                      type="button"
                      onClick={() => {
                        setActiveCat(f.category);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="group rounded-2xl border border-border bg-card/70 p-5 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-gold/50 hover:shadow-[var(--shadow-card)]"
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-gold-foreground">
                        <Sparkles className="size-3" /> Popular
                      </span>
                      <h3 className="mt-3 font-display text-lg text-foreground">{f.q}</h3>
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{f.a}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ACCORDION LIST */}
            <div className="mt-9">
              <h2 className="font-display text-2xl text-foreground">
                {activeCat === "All" ? "All Questions" : activeCat}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filtered.length})
                </span>
              </h2>

              {activeCat === "Cosmetics Authenticity" && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-gold/30 bg-card/70 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <ShieldCheck className="size-4 shrink-0 text-primary" />
                    Read our full cosmetics authenticity commitment and complaint process.
                  </p>
                  <Button asChild variant="outline" size="sm" className="shrink-0 border-gold/40">
                    <Link to="/authenticity-policy">View Authenticity Policy</Link>
                  </Button>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No matching question found. Contact us directly and we&apos;ll help you.
                  </p>
                  <Button asChild className="mt-4 bg-gold text-gold-foreground hover:bg-gold/90">
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="size-4" /> Chat on WhatsApp
                    </a>
                  </Button>
                </div>
              ) : (
                <Accordion type="single" collapsible className="mt-4 space-y-3">
                  {filtered.map((f, i) => (
                    <AccordionItem
                      key={f.q}
                      value={`f${i}`}
                      className="animate-fade-in overflow-hidden rounded-2xl border border-border bg-card/70 px-5 backdrop-blur-sm transition-colors hover:border-gold/40"
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <AccordionTrigger className="py-4 text-left font-display text-base text-foreground hover:no-underline sm:text-lg">
                        <span className="flex flex-col items-start gap-1 pr-2">
                          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-gold-foreground/70">
                            {f.category}
                          </span>
                          <span>{f.q}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">
                        {f.a}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          </div>

          {/* STICKY SUPPORT CARD (desktop) */}
          <aside className="mt-10 hidden lg:mt-0 lg:block">
            <div className="site-sticky-with-gap sticky space-y-5">
              <div className="rounded-2xl border border-gold/30 bg-primary p-6 text-primary-foreground shadow-[var(--shadow-card)]">
                <span className="inline-flex size-11 items-center justify-center rounded-full bg-gold/20 text-gold">
                  <Headphones className="size-5" />
                </span>
                <h3 className="mt-4 font-display text-2xl text-gold">Still need help?</h3>
                <p className="mt-2 text-sm leading-relaxed text-primary-foreground/85">
                  Our support team can help you choose size, confirm product details, or track your
                  order.
                </p>
                <div className="mt-5 space-y-2.5">
                  <Button asChild className="w-full bg-gold text-gold-foreground hover:bg-gold/90">
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="size-4" /> Chat on WhatsApp
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
                  >
                    <Link to="/contact">
                      <Headphones className="size-4" /> Contact Support
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
                  >
                    <Link to="/return-policy">
                      <RefreshCw className="size-4" /> View Return Policy
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* POLICY QUICK LINKS */}
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Custom Size Policy", to: "/custom-size-policy", icon: Ruler },
            { label: "Return Policy", to: "/return-policy", icon: RefreshCw },
            { label: "Privacy Policy", to: "/privacy-policy", icon: Lock },
            { label: "Delivery Information", to: "/delivery-policy", icon: Truck },
          ].map(({ label, to, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-sm font-medium text-foreground shadow-[var(--shadow-soft)] transition-all hover:-translate-y-0.5 hover:border-gold/40"
            >
              <Icon className="size-4 shrink-0 text-primary" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* MOBILE HELP CTA */}
      <section
        className="relative isolate overflow-hidden lg:hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="relative mx-auto max-w-2xl px-4 py-14 text-center sm:px-6">
          <Heart className="mx-auto size-6 text-gold" />
          <h2 className="mt-3 font-display text-3xl text-gold">Still need help?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-primary-foreground/85">
            Our support team can help you choose size, confirm product details, or track your order.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" /> Chat on WhatsApp
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
            >
              <Link to="/contact">Contact Support</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
            >
              <Link to="/return-policy">View Return Policy</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
