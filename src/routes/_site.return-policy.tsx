import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { BRAND } from "@/lib/brand";
import logo from "@/assets/nongorr-logo-transparent.webp";
import {
  Clock,
  RefreshCw,
  Scissors,
  Sparkles,
  PackageCheck,
  MessageCircle,
  Search,
  CheckCircle2,
  XCircle,
  Ruler,
  Shirt,
  Droplets,
  HelpCircle,
  Truck,
  Wallet,
  Info,
  ShoppingBag,
  MapPin,
  Heart,
} from "lucide-react";

// TODO: Final legal/business review required before production launch.
// NOTE: This is static UI/UX content only. No backend, database, CMS, courier API,
//       or automation is connected. The return & exchange policy below is placeholder
//       copy and must be reviewed by a qualified party before going live.

export const Route = createFileRoute("/_site/return-policy")({
  head: () => ({
    meta: [
      { title: "Return & Exchange Policy · Nongorr" },
      {
        name: "description",
        content:
          "Understand Nongorr's return & exchange policy: 24-hour reporting, custom-size and cosmetics rules, eligible items, and how to request an exchange.",
      },
      { property: "og:title", content: "Return & Exchange Policy · Nongorr" },
      {
        property: "og:description",
        content:
          "Shop with confidence. Clear, customer-friendly return and exchange rules for kurti, saree, three piece, girls dress and cosmetics.",
      },
      { property: "og:url", content: "/return-policy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/return-policy" }],
  }),
  component: ReturnPolicy,
});

const whatsappBase = `https://wa.me/${BRAND.whatsapp}`;
const exchangeHref = `${whatsappBase}?text=${encodeURIComponent(
  "Hi Nongorr, I want to request an exchange for Order ID: [Order ID]. My issue is:",
)}`;
const helpHref = `${whatsappBase}?text=${encodeURIComponent(
  "Hi Nongorr, I need help with my order.",
)}`;

const summaryCards = [
  {
    icon: Clock,
    title: "Check Within 24 Hours",
    text: "Please inspect your product after receiving it and contact us within 24 hours if there is any issue.",
  },
  {
    icon: RefreshCw,
    title: "Exchange for Wrong or Defective Item",
    text: "If you receive a wrong, damaged, or defective product, we will help with exchange or resolution.",
  },
  {
    icon: Scissors,
    title: "Custom Size Rules",
    text: "Custom-size kurtis are made specially for you and cannot be returned unless there is a defect or major mistake from our side.",
  },
  {
    icon: Sparkles,
    title: "Cosmetics Safety",
    text: "Cosmetics, makeup, and serum items must be unopened, unused, and sealed for any exchange request.",
  },
];

const timeline = [
  {
    icon: PackageCheck,
    title: "Receive Your Order",
    text: "Open and check your parcel carefully.",
  },
  {
    icon: MessageCircle,
    title: "Report Within 24 Hours",
    text: "Message us on WhatsApp with order ID, photos, and issue details.",
  },
  {
    icon: Search,
    title: "Team Review",
    text: "Our team checks the issue and confirms if exchange/return is eligible.",
  },
  {
    icon: RefreshCw,
    title: "Exchange or Resolution",
    text: "If approved, we guide you through exchange, replacement, or other solution.",
  },
];

type Section = {
  id: string;
  icon: typeof Clock;
  title: string;
  body?: string;
  bullets?: string[];
  bulletTone?: "ok" | "no";
  note?: string;
  measurement?: boolean;
  cta?: boolean;
  required?: string[];
};

const sections: Section[] = [
  {
    id: "eligibility",
    icon: CheckCircle2,
    title: "When Exchange Is Accepted",
    body: "We accept exchange requests only if the product is wrong, damaged, defective, or significantly different from the ordered item. Customers must contact Nongorr within 24 hours of receiving the parcel.",
    bullets: [
      "Wrong product delivered",
      "Wrong size sent by Nongorr",
      "Damaged product received",
      "Defective stitching or visible product defect",
      "Missing item from order",
      "Product does not match confirmed order details",
    ],
    bulletTone: "ok",
  },
  {
    id: "not-eligible",
    icon: XCircle,
    title: "Items Not Eligible for Return or Exchange",
    body: "To maintain hygiene, quality, and fairness, some products are not eligible for return or exchange.",
    bullets: [
      "Used, washed, altered, or damaged products",
      "Products without original packaging or tags",
      "Products damaged after delivery",
      "Custom-size kurtis, unless there is a mistake from Nongorr",
      "Saree or clothing damaged due to wrong handling, washing, or ironing",
      "Cosmetics, makeup, serum, or skincare products that are opened, used, unsealed, or tested",
      "Sale/clearance items, if marked as non-returnable",
      "Change-of-mind requests after order confirmation or delivery",
    ],
    bulletTone: "no",
  },
  {
    id: "custom-size",
    icon: Ruler,
    title: "Custom Size Kurti Policy",
    body: "Custom-size kurtis are made according to the measurements provided by the customer. Because these items are specially prepared, they cannot be returned or exchanged unless there is a clear production defect or a major measurement mistake from Nongorr's side.",
    note: "Please double-check your measurements before placing a custom-size order. If you are unsure, contact us on WhatsApp before ordering.",
    measurement: true,
  },
  {
    id: "ready-size",
    icon: Shirt,
    title: "Ready Size Clothing",
    body: "For ready-size kurtis, stitched three pieces, and girls dress items, exchange may be possible if the product is unused, unwashed, and reported within 24 hours. Exchange depends on stock availability.",
    bullets: [
      "Product must be unused and unwashed",
      "Original packaging/tags should be intact where applicable",
      "Exchange is subject to available size/stock",
      "Delivery charge for exchange may apply unless the mistake is from Nongorr",
    ],
    bulletTone: "ok",
  },
  {
    id: "saree",
    icon: Heart,
    title: "Saree Exchange Policy",
    body: "Sarees are usually one-size products. Exchange may be accepted only if the wrong saree was delivered, the item is damaged, or there is a clear defect.",
    bullets: [
      "No return for change of mind",
      "No return after wearing, washing, fall/pico work, or alteration",
      "Colour may slightly vary due to lighting, camera, or screen settings",
    ],
    bulletTone: "no",
  },
  {
    id: "cosmetics",
    icon: Droplets,
    title: "Cosmetics & Beauty Product Policy",
    body: "For hygiene and safety, cosmetics, makeup, serum, and skincare products cannot be returned or exchanged once opened, used, unsealed, or tested. Exchange may be accepted only if:",
    bullets: [
      "Wrong item delivered",
      "Product received damaged",
      "Product is expired at delivery",
      "Seal is broken before delivery",
      "Issue reported within 24 hours with photo/video proof",
    ],
    bulletTone: "ok",
  },
  {
    id: "how-to-request",
    icon: HelpCircle,
    title: "How to Request an Exchange",
    body: "To request an exchange, contact Nongorr on WhatsApp within 24 hours of receiving your order.",
    required: [
      "Order ID",
      "Customer name",
      "Phone number",
      "Clear photos of product",
      "Unboxing video if available",
      "Short explanation of the issue",
    ],
    cta: true,
  },
  {
    id: "exchange-charge",
    icon: Truck,
    title: "Exchange Delivery Charge",
    body: "If the issue is caused by Nongorr, such as wrong item, wrong size sent, or defective product, Nongorr will guide the customer with the best possible resolution. If the exchange is requested due to customer preference or size change, delivery charge may apply.",
  },
  {
    id: "refund",
    icon: Wallet,
    title: "Refund Policy",
    body: "Nongorr mainly offers exchange or replacement where possible. Refunds may be considered only in special cases where exchange or replacement is not possible. Refund approval depends on order condition and team review.",
    note: "For manual bKash payment orders, approved refunds will be processed to a valid bKash/Nagad/bank account provided by the customer.",
  },
  {
    id: "important-notes",
    icon: Info,
    title: "Important Notes",
    bullets: [
      "Product colour may slightly differ due to lighting, photography, and screen settings",
      "Minor handmade variation is normal and not considered a defect",
      "Customer must provide correct phone number, address, and measurements",
      "Failed delivery due to wrong address or unreachable phone may cause extra delivery charge",
      "Nongorr reserves the right to reject unfair or suspicious return/exchange claims",
    ],
  },
];

const measurements = ["Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Kurti Length"];

const tableRows = [
  ["Kurti", "Ready Size", "Exchange possible if unused and reported within 24 hours"],
  ["Kurti", "Custom Size", "No return unless defect or Nongorr mistake"],
  ["Saree", "One Size", "Exchange only for wrong/damaged/defective item"],
  ["Three Piece", "Stitched", "Exchange possible if eligible and stock available"],
  ["Three Piece", "Unstitched", "Exchange only for wrong/damaged/defective item"],
  ["Girls Dress", "Age/Size Based", "Exchange possible if unused and stock available"],
  ["Cosmetics/Makeup/Serum", "Quantity/Shade/ml", "No return if opened/used/unsealed"],
];

const simpleSummary = [
  "Check your parcel as soon as you receive it.",
  "Tell us within 24 hours if something is wrong.",
  "Custom-size products cannot be returned unless we made a mistake.",
  "Cosmetics must be sealed and unused.",
  "We are here to help if the issue is genuine.",
];

function SectionInner({ section }: { section: Section }) {
  return (
    <>
      {section.body && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
      )}
      {section.bullets && (
        <ul className="mt-4 space-y-2">
          {section.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm text-foreground">
              {section.bulletTone === "no" ? (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <span className="text-muted-foreground">{b}</span>
            </li>
          ))}
        </ul>
      )}
      {section.measurement && (
        <div className="mt-4 flex flex-wrap gap-2">
          {measurements.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-foreground"
            >
              <Ruler className="size-3 text-gold-foreground" />
              {m}
            </span>
          ))}
        </div>
      )}
      {section.required && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {section.required.map((r) => (
            <li
              key={r}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
            >
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              {r}
            </li>
          ))}
        </ul>
      )}
      {section.note && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/10 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-gold-foreground" />
          <p className="text-sm leading-relaxed text-foreground">{section.note}</p>
        </div>
      )}
      {section.cta && (
        <Button asChild className="mt-5 bg-gold text-gold-foreground hover:bg-gold/90">
          <a href={exchangeHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" />
            Request on WhatsApp
          </a>
        </Button>
      )}
    </>
  );
}

function ReturnPolicy() {
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overflow-hidden">
      {/* 1 — HERO */}
      <section className="relative isolate border-b border-border bg-secondary/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: "var(--gradient-gold)" }}
        />
        <img
          aria-hidden
          src={logo}
          alt=""
          className="pointer-events-none absolute -right-10 top-1/2 hidden w-72 -translate-y-1/2 opacity-[0.06] sm:block"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="eyebrow">Shop With Confidence</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-5xl md:text-6xl">
            Return &amp; Exchange Policy
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            At Nongorr, we want every order to feel thoughtful, beautiful, and right for you. Please
            read our return and exchange policy before placing an order.
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-gold-foreground/70">
            Last updated: 2026
          </p>
          <div className="ornament-divider mx-auto mt-6 w-40" />
        </div>
      </section>

      {/* 2 — QUICK SUMMARY CARDS */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-card)]"
            >
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-6" />
              </span>
              <h3 className="mt-4 font-display text-xl text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — TIMELINE */}
      <section className="bg-secondary/30 py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="eyebrow">How It Works</span>
            <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
              A Simple, Caring Process
            </h2>
            <div className="ornament-divider mx-auto mt-4 w-32" />
          </div>
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {timeline.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="relative flex gap-4 md:flex-col md:gap-0 md:text-center">
                <div className="flex flex-col items-center md:flex-row md:justify-center">
                  <span className="relative z-10 inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
                    <Icon className="size-5" />
                  </span>
                  {i < timeline.length - 1 && (
                    <span
                      aria-hidden
                      className="mt-2 h-full w-px bg-border md:mt-0 md:h-px md:w-full md:flex-1"
                    />
                  )}
                </div>
                <div className="pb-2 md:mt-4">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gold-foreground/70">
                    Step {i + 1}
                  </span>
                  <h3 className="mt-1 font-display text-lg text-foreground">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:mx-auto md:max-w-[18rem]">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4 — MAIN POLICY CONTENT */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
          {/* Desktop sticky TOC */}
          <aside className="hidden lg:block">
            <nav className="site-sticky-with-gap sticky rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
              <p className="eyebrow">Policy Sections</p>
              <ol className="mt-3 space-y-1">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        activeId === s.id
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      }`}
                    >
                      <span className="tabular-nums opacity-60">{i + 1}.</span>
                      <span>{s.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          {/* Desktop content cards */}
          <div className="hidden space-y-6 lg:block">
            {sections.map((section, i) => (
              <article
                key={section.id}
                id={section.id}
                className="scroll-mt-24 rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <section.icon className="size-5" />
                  </span>
                  <h2 className="font-display text-2xl text-foreground">
                    <span className="text-gold-foreground/60">{i + 1}.</span> {section.title}
                  </h2>
                </div>
                <SectionInner section={section} />
              </article>
            ))}
          </div>

          {/* Mobile accordion */}
          <div className="lg:hidden">
            <Accordion
              type="single"
              collapsible
              defaultValue={sections[0].id}
              className="space-y-3"
            >
              {sections.map((section, i) => (
                <AccordionItem
                  key={section.id}
                  value={section.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card px-4 shadow-[var(--shadow-soft)]"
                >
                  <AccordionTrigger className="py-4 text-left hover:no-underline">
                    <span className="flex items-center gap-3">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <section.icon className="size-4.5" />
                      </span>
                      <span className="font-display text-lg text-foreground">
                        <span className="text-gold-foreground/60">{i + 1}.</span> {section.title}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-5">
                    <SectionInner section={section} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* 5 — CATEGORY TABLE */}
      <section className="bg-secondary/30 py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="text-center">
            <span className="eyebrow">At a Glance</span>
            <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
              Category-Specific Rules
            </h2>
            <div className="ornament-divider mx-auto mt-4 w-32" />
          </div>

          {/* Desktop table */}
          <div className="mt-8 hidden overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="px-5 py-3.5 font-display text-base font-medium">Product Type</th>
                  <th className="px-5 py-3.5 font-display text-base font-medium">
                    Size/Variant Type
                  </th>
                  <th className="px-5 py-3.5 font-display text-base font-medium">
                    Return/Exchange Rule
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={row.join("-")} className={i % 2 ? "bg-secondary/30" : "bg-card"}>
                    <td className="px-5 py-3.5 font-medium text-foreground">{row[0]}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{row[1]}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="mt-8 space-y-4 sm:hidden">
            {tableRows.map((row) => (
              <div
                key={row.join("-")}
                className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg text-foreground">{row[0]}</h3>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                    {row[1]}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{row[2]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 — IN SIMPLE WORDS */}
      <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
        <div className="text-center">
          <span className="eyebrow">Plain &amp; Simple</span>
          <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
            Return Policy in Simple Words
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-32" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {simpleSummary.map((text) => (
            <div
              key={text}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]"
            >
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gold-foreground" />
              <p className="text-sm leading-relaxed text-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7 — FINAL CTA */}
      <section
        className="relative isolate overflow-hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <img
          aria-hidden
          src={logo}
          alt=""
          className="pointer-events-none absolute -left-10 bottom-0 w-64 opacity-[0.07]"
        />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="font-display text-3xl text-gold sm:text-4xl">Need Help with an Order?</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/85">
            If something feels wrong with your order, message us as soon as possible. Our team will
            guide you with care.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90">
              <a href={helpHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
                Message on WhatsApp
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
            >
              <Link to="/track">
                <MapPin className="size-4" />
                Track Your Order
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
            >
              <Link to="/shop">
                <ShoppingBag className="size-4" />
                Continue Shopping
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
