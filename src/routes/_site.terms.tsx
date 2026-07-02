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
  FileCheck,
  Building2,
  ImageIcon,
  LayoutGrid,
  Ruler,
  Tag,
  ClipboardList,
  Smartphone,
  CheckCircle2,
  Truck,
  RefreshCw,
  Droplets,
  UserCircle,
  ShieldAlert,
  Copyright,
  Scale,
  Lock,
  RefreshCcw,
  MessageCircle,
  Mail,
  Instagram,
  Facebook,
  ShoppingBag,
  Info,
  ShieldCheck,
} from "lucide-react";

// TODO: Final legal/business review required before production launch.
// NOTE: This is static UI/UX content only. No backend, database, CMS, courier API,
//       payment API, or legal automation is connected. The terms below are placeholder
//       copy and must be reviewed by a qualified party before going live.

export const Route = createFileRoute("/_site/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions · Nongorr" },
      {
        name: "description",
        content:
          "Nongorr Terms & Conditions: shopping rules, manual bKash payment, custom-size orders, delivery, returns, cosmetics rules, accounts and website use.",
      },
      { property: "og:title", content: "Terms & Conditions · Nongorr" },
      {
        property: "og:description",
        content:
          "Please read carefully. The terms that keep your Nongorr shopping experience clear, safe, and trustworthy.",
      },
      { property: "og:url", content: "/terms" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/terms" }],
  }),
  component: Terms,
});

const whatsappBase = `https://wa.me/${BRAND.whatsapp}`;
const helpHref = `${whatsappBase}?text=${encodeURIComponent(
  "Hi Nongorr, I have a question before placing my order.",
)}`;

const summaryCards = [
  {
    icon: ClipboardList,
    title: "Order Carefully",
    text: "Please check product details, size, color, delivery address, and payment information before confirming your order.",
  },
  {
    icon: Smartphone,
    title: "Manual bKash Payment",
    text: "Orders paid by manual bKash remain pending until the TrxID and payment details are verified by Nongorr.",
  },
  {
    icon: Ruler,
    title: "Custom Size Responsibility",
    text: "Customers must provide accurate measurements for custom-size kurtis.",
  },
  {
    icon: ShieldCheck,
    title: "Clear Policies",
    text: "Delivery, return, exchange, and privacy rules are part of these terms.",
  },
];

type Section = {
  id: string;
  icon: typeof FileCheck;
  title: string;
  body?: string;
  bullets?: string[];
  note?: string;
  link?: { label: string; to: string };
  contact?: boolean;
};

const sections: Section[] = [
  {
    id: "acceptance",
    icon: FileCheck,
    title: "Acceptance of Terms",
    body: "By using Nongorr Studio, browsing products, creating an account, placing an order, or contacting us for support, you agree to follow these Terms & Conditions. If you do not agree with any part of these terms, please do not place an order.",
  },
  {
    id: "about",
    icon: Building2,
    title: "About Nongorr",
    body: "Nongorr is a premium women-focused boutique brand founded by Miskatul Afrin Anika. The brand currently sells kurti and plans to expand into saree, three piece, girls dress, cosmetics, makeup, serum, and other women-focused fashion and beauty products.",
  },
  {
    id: "product-information",
    icon: ImageIcon,
    title: "Product Information",
    body: "We try our best to show accurate product photos, colors, prices, fabric details, size information, and descriptions. However, slight color differences may occur due to lighting, photography, editing, or device screen settings.",
    bullets: [
      "Product images are for visual reference",
      "Color may slightly vary in real life",
      "Handmade/craft-based products may have minor variations",
      "Product availability may change without notice",
    ],
  },
  {
    id: "categories-size",
    icon: LayoutGrid,
    title: "Product Categories & Size Rules",
    body: "Nongorr uses category-specific product rules so customers can shop more clearly.",
    bullets: [
      "Kurti may have ready size and custom-size options",
      "Saree is usually one size",
      "Three piece may be stitched or unstitched",
      "Girls dress may use age/height-based sizes",
      "Cosmetics, makeup, and serum do not use clothing size",
    ],
  },
  {
    id: "custom-size",
    icon: Ruler,
    title: "Custom Size Orders",
    body: "Custom-size kurtis are prepared based on the measurements provided by the customer. Customers are responsible for providing accurate measurements such as bust, waist, hip, shoulder, sleeve, and kurti length.",
    note: "Custom-size products cannot usually be returned or exchanged unless there is a clear defect or a major mistake from Nongorr's side.",
    bullets: [
      "Double-check measurements before ordering",
      "Contact Nongorr on WhatsApp if unsure",
      "Custom-size charge may apply",
      "Custom-size orders may take extra processing time",
    ],
  },
  {
    id: "pricing",
    icon: Tag,
    title: "Pricing & Availability",
    body: "Product prices, discounts, stock, and offers may change from time to time. Nongorr reserves the right to update pricing, correct errors, change offers, or remove products without prior notice.",
    bullets: [
      "Sale prices are valid for a limited time",
      "Coupon discounts may have conditions",
      "Product stock is subject to availability",
      "Final order total will be confirmed during checkout",
    ],
  },
  {
    id: "order-placement",
    icon: ClipboardList,
    title: "Order Placement",
    body: "Customers must provide correct name, phone number, delivery address, district, thana/upazila, product selection, size, color, quantity, and payment information. Nongorr is not responsible for delays caused by incorrect customer information.",
    bullets: [
      "Check all order details before submission",
      "Provide an active phone number",
      "Mention special instructions in the order note",
      "For custom size, provide accurate measurements",
    ],
  },
  {
    id: "bkash-payment",
    icon: Smartphone,
    title: "Manual bKash Payment",
    body: "For now, Nongorr supports manual bKash payment. Customers must send the payment manually to the official Nongorr bKash number and submit the sender number, TrxID, and optional screenshot during checkout.",
    bullets: [
      "Payment must be verified before order confirmation",
      "Wrong or duplicate TrxID may delay confirmation",
      "Fake, incorrect, or suspicious payment information may result in order cancellation",
      "Do not send payment to unofficial numbers or unknown accounts",
    ],
    note: "Always confirm the official bKash number from Nongorr's checkout page or official support channel.",
  },
  {
    id: "confirmation-cancellation",
    icon: CheckCircle2,
    title: "Order Confirmation & Cancellation",
    body: "An order is not fully confirmed until payment and order details are verified by Nongorr. Nongorr may contact the customer through phone or WhatsApp for confirmation.",
    bullets: [
      "Orders with pending payment may be held for a limited time",
      "Nongorr may cancel unpaid or suspicious orders",
      "Customers should contact support quickly for correction requests",
      "Once processing or courier booking starts, cancellation may not be possible",
    ],
  },
  {
    id: "delivery",
    icon: Truck,
    title: "Delivery & Courier",
    body: "Nongorr delivers orders through courier partners. Delivery time may vary depending on location, courier availability, weather, holidays, or operational delays.",
    bullets: [
      "Inside Dhaka delivery may take approximately 1–3 working days",
      "Outside Dhaka delivery may take approximately 3–5 working days",
      "Delivery charge may vary by district or parcel type",
      "Incorrect address or unreachable phone may cause delay or extra charge",
      "Courier tracking may be provided when available",
    ],
  },
  {
    id: "return-exchange",
    icon: RefreshCw,
    title: "Return & Exchange",
    body: "Return and exchange requests are handled according to Nongorr's Return & Exchange Policy. Customers should inspect products after delivery and report issues within the required time.",
    bullets: [
      "Wrong, damaged, or defective products may be eligible for exchange",
      "Custom-size products are not returnable unless Nongorr made a clear mistake",
      "Used, washed, altered, or damaged items are not eligible",
      "Cosmetics and beauty items must be unopened and unused",
      "Exchange depends on stock availability and review",
    ],
    link: { label: "View Return Policy", to: "/return-policy" },
  },
  {
    id: "cosmetics",
    icon: Droplets,
    title: "Cosmetics & Beauty Products",
    body: "For hygiene and safety reasons, cosmetics, makeup, serum, and skincare products cannot be returned or exchanged once opened, used, unsealed, or tested. Exchange may be considered only if:",
    bullets: [
      "Wrong item delivered",
      "Product damaged during delivery",
      "Product expired at delivery",
      "Seal broken before delivery",
      "Issue reported within the required time with photo/video proof",
    ],
  },
  {
    id: "account",
    icon: UserCircle,
    title: "Customer Account",
    body: "If customers create an account, they are responsible for keeping their login details secure. Account features may include wishlist, order history, saved addresses, and custom measurement data after backend integration.",
    bullets: [
      "Use accurate information",
      "Do not share login credentials",
      "Contact support if account activity seems suspicious",
      "Nongorr may restrict accounts involved in suspicious activity",
    ],
  },
  {
    id: "user-responsibilities",
    icon: ShieldAlert,
    title: "User Responsibilities",
    body: "Customers agree to use Nongorr Studio honestly and respectfully.",
    bullets: [
      "Do not submit fake orders",
      "Do not provide false payment information",
      "Do not misuse coupon codes",
      "Do not harass support staff",
      "Do not attempt to access admin or restricted areas",
      "Do not copy brand content without permission",
    ],
  },
  {
    id: "brand-assets",
    icon: Copyright,
    title: "Website Content & Brand Assets",
    body: "All images, logos, designs, product descriptions, graphics, brand elements, and website content belong to Nongorr unless otherwise stated. Customers or third parties may not copy, reuse, sell, or reproduce Nongorr content without permission.",
  },
  {
    id: "liability",
    icon: Scale,
    title: "Limitation of Liability",
    body: "Nongorr will try its best to provide accurate service, secure shopping, and timely delivery. However, Nongorr is not responsible for delays or issues caused by courier partners, incorrect customer information, unavoidable events, technical errors, or circumstances beyond our control.",
  },
  {
    id: "privacy",
    icon: Lock,
    title: "Privacy",
    body: "Nongorr respects customer privacy. Customer information is collected and used for order processing, payment verification, delivery, customer support, and shopping experience improvement.",
    link: { label: "View Privacy Policy", to: "/privacy-policy" },
  },
  {
    id: "changes",
    icon: RefreshCcw,
    title: "Changes to Terms",
    body: "Nongorr may update these Terms & Conditions as the business grows, especially when new features such as online payment gateway, courier API, customer accounts, or loyalty programs are added. The latest version will always be available on this page.",
  },
  {
    id: "contact",
    icon: MessageCircle,
    title: "Contact Us",
    body: "If you have questions about these Terms & Conditions, please contact Nongorr through our official WhatsApp, Facebook, Instagram, or support email.",
    contact: true,
  },
];

const simpleSummary = [
  "Check product details before ordering",
  "Use the official bKash number only",
  "Submit correct TrxID for payment verification",
  "Custom-size items need accurate measurements",
  "Report wrong or damaged products quickly",
  "Contact us if you need help before placing an order",
];

function ContactLinks() {
  const items = [
    { icon: MessageCircle, label: "WhatsApp", value: BRAND.whatsapp, href: whatsappBase },
    { icon: Mail, label: "Email", value: BRAND.email, href: `mailto:${BRAND.email}` },
    { icon: Instagram, label: "Instagram", value: "@nongorr", href: BRAND.instagram },
    { icon: Facebook, label: "Facebook", value: "Nongorr", href: BRAND.facebook },
  ];
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {items.map(({ icon: Icon, label, value, href }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm transition-colors hover:border-gold/40 hover:bg-secondary"
        >
          <Icon className="size-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">{label}:</span> {value}
          </span>
        </a>
      ))}
    </div>
  );
}

function SectionInner({ section }: { section: Section }) {
  return (
    <>
      {section.body && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
      )}
      {section.bullets && (
        <ul className="mt-4 space-y-2">
          {section.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-gold-foreground" />
              <span className="text-muted-foreground">{b}</span>
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
      {section.link && (
        <Button
          asChild
          variant="outline"
          className="mt-5 border-primary/30 text-primary hover:bg-primary/5"
        >
          <Link to={section.link.to}>{section.link.label}</Link>
        </Button>
      )}
      {section.contact && <ContactLinks />}
    </>
  );
}

function Terms() {
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
          <span className="eyebrow">Please Read Carefully</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-5xl md:text-6xl">
            Terms &amp; Conditions
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            By browsing, ordering, or using Nongorr Studio, you agree to the following terms
            designed to keep your shopping experience clear, safe, and trustworthy.
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

      {/* 3 — MAIN TERMS CONTENT */}
      <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-10">
          {/* Desktop sticky TOC */}
          <aside className="hidden lg:block">
            <nav className="site-sticky-with-gap site-sticky-max-height sticky overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
              <p className="eyebrow">On this page</p>
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

      {/* 4 — IMPORTANT NOTICE */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-primary p-7 text-primary-foreground shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold">
              <Info className="size-6" />
            </span>
            <div>
              <h3 className="font-display text-2xl text-gold">Important Before You Order</h3>
              <p className="mt-2 text-sm leading-relaxed text-primary-foreground/85">
                Please read product details, size information, custom measurement instructions,
                delivery rules, return policy, and payment instructions carefully before placing an
                order. If you are unsure, contact Nongorr on WhatsApp before confirming your order.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 — IN SIMPLE WORDS */}
      <section className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
        <div className="text-center">
          <span className="eyebrow">Plain &amp; Simple</span>
          <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
            Terms in Simple Words
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-32" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* 6 — FINAL CTA */}
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
          <h2 className="font-display text-3xl text-gold sm:text-4xl">
            Need Help Before Ordering?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/85">
            Our team is happy to guide you with size, payment, delivery, and product questions.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90">
              <a href={helpHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
                Chat on WhatsApp
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-gold"
            >
              <Link to="/return-policy">
                <RefreshCw className="size-4" />
                View Return Policy
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
