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
import { absUrl } from "@/lib/site-config";
import {
  ShieldCheck,
  Lock,
  HandHeart,
  FileText,
  Database,
  Smartphone,
  Truck,
  UserCircle,
  Cookie,
  Share2,
  ShieldCheck as ShieldIcon,
  Scale,
  RefreshCcw,
  MessageCircle,
  Mail,
  Instagram,
  Facebook,
  ShoppingBag,
  AlertTriangle,
} from "lucide-react";

// TODO: Final legal review required before production launch.
// NOTE: This is static UI/UX content only. No backend, database, or CMS is connected.
//       The privacy policy below is placeholder copy and must be reviewed by a
//       qualified party before going live in production.

export const Route = createFileRoute("/_site/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy · Nongorr" },
      {
        name: "description",
        content:
          "How Nongorr collects, uses and protects your personal information, order details, manual bKash payment proof and contact information when you shop with us.",
      },
      { property: "og:title", content: "Privacy Policy · Nongorr" },
      {
        property: "og:description",
        content:
          "Your trust matters. Learn how Nongorr carefully handles your personal and payment information.",
      },
      { property: "og:url", content: absUrl("/privacy-policy") },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: absUrl("/privacy-policy") }],
  }),
  component: PrivacyPolicy,
});

const CURRENT_YEAR = new Date().getFullYear();

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hello Nongorr! I have a question about your Privacy Policy.",
)}`;

const trustCards = [
  {
    icon: ShieldCheck,
    title: "Secure Shopping",
    text: "We collect only the information needed to process and deliver your order.",
  },
  {
    icon: Lock,
    title: "Payment Privacy",
    text: "Manual bKash information and payment proof are used only for order verification.",
  },
  {
    icon: HandHeart,
    title: "No Unnecessary Sharing",
    text: "We do not sell customer information to third parties.",
  },
];

const sections = [
  {
    id: "information-we-collect",
    icon: Database,
    title: "Information We Collect",
    body: "When you place an order, create an account, contact us, or interact with Nongorr, we may collect information such as your name, phone number, email address, delivery address, order details, selected size, custom measurements, payment reference, bKash transaction ID, and optional payment screenshot.",
  },
  {
    id: "how-we-use-your-information",
    icon: FileText,
    title: "How We Use Your Information",
    body: "We use your information to confirm orders, process manual payment verification, prepare products, arrange delivery, provide customer support, improve shopping experience, manage returns or exchanges, and send important order updates.",
  },
  {
    id: "manual-bkash-payment-information",
    icon: Smartphone,
    title: "Manual bKash Payment Information",
    body: "For manual bKash payments, customers may provide sender number, TrxID, and optional payment screenshot. This information is used only to verify payment and match it with the correct order. Payment screenshots should only be accessible to authorized Nongorr admin users after backend integration.",
  },
  {
    id: "order-delivery-information",
    icon: Truck,
    title: "Order & Delivery Information",
    body: "To deliver your order, we may share necessary delivery information such as name, phone number, address, order ID, and parcel details with courier partners. We only share the information required for delivery.",
  },
  {
    id: "account-wishlist-data",
    icon: UserCircle,
    title: "Account, Wishlist & Custom Measurement Data",
    body: "If you create an account, we may save your order history, wishlist items, addresses, and custom measurement information to make future shopping easier. Customers should be able to update or request deletion of their information after backend account features are connected.",
  },
  {
    id: "cookies-analytics",
    icon: Cookie,
    title: "Cookies & Analytics",
    body: "Nongorr may use cookies or analytics tools in the future to understand website performance, improve product discovery, and provide a better shopping experience. These tools should not be used to collect unnecessary personal information.",
  },
  {
    id: "sharing-information",
    icon: Share2,
    title: "Sharing Information with Delivery Partners",
    body: "We do not sell customer personal information. We may only share necessary information with trusted service providers such as courier partners, payment verification support, hosting providers, or tools needed to operate the website.",
  },
  {
    id: "data-security",
    icon: ShieldIcon,
    title: "Data Security",
    body: "We aim to protect customer information using secure systems, restricted admin access, and careful data handling. Sensitive information such as payment screenshots and customer order data should be protected with proper access controls after backend integration.",
  },
  {
    id: "customer-rights",
    icon: Scale,
    title: "Customer Rights",
    body: "Customers may contact Nongorr to request correction, update, or removal of their personal information where applicable. We will do our best to respond to reasonable requests.",
  },
  {
    id: "policy-updates",
    icon: RefreshCcw,
    title: "Policy Updates",
    body: "Nongorr may update this Privacy Policy as the business grows, especially when new features such as online payment gateway, courier API, customer accounts, or analytics tools are added. The latest version will always be available on this page.",
  },
  {
    id: "contact-us",
    icon: MessageCircle,
    title: "Contact Us",
    body: "If you have any questions about this Privacy Policy, please contact us through our official WhatsApp, Facebook, Instagram, or support email.",
    contact: true,
  },
];

const simpleSummary = [
  "We collect your details only to process your order.",
  "We use bKash TrxID only to verify payment.",
  "We share delivery details only with courier partners.",
  "We do not sell your personal information.",
];

function PrivacyPolicy() {
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
          <span className="eyebrow">Your Trust Matters</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-5xl md:text-6xl">
            Privacy Policy
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            At Nongorr, we value your trust. This policy explains how we collect, use, and protect
            your information when you shop with us.
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-gold-foreground/70">
            Last updated: {CURRENT_YEAR}
          </p>
          <div className="ornament-divider mx-auto mt-6 w-40" />
        </div>
      </section>

      {/* 2 — QUICK TRUST SUMMARY */}
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-5 sm:grid-cols-3">
          {trustCards.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6 text-center shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-card)]"
            >
              <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-6" />
              </span>
              <h3 className="mt-4 font-display text-xl text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — MAIN CONTENT */}
      <section className="mx-auto max-w-6xl px-4 pb-4 sm:px-6">
        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
          {/* Desktop sticky TOC */}
          <aside className="hidden lg:block">
            <nav className="site-sticky-with-gap sticky rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
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
            {sections.map(({ id, icon: Icon, title, body, contact }, i) => (
              <article
                key={id}
                id={id}
                className="scroll-mt-24 rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <h2 className="font-display text-2xl text-foreground">
                    <span className="text-gold-foreground/60">{i + 1}.</span> {title}
                  </h2>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{body}</p>
                {contact && <ContactLinks />}
              </article>
            ))}
          </div>

          {/* Mobile / tablet accordion */}
          <div className="lg:hidden">
            <Accordion
              type="single"
              collapsible
              defaultValue={sections[0].id}
              className="space-y-3"
            >
              {sections.map(({ id, icon: Icon, title, body, contact }, i) => (
                <AccordionItem
                  key={id}
                  value={id}
                  className="overflow-hidden rounded-2xl border border-border bg-card px-4 shadow-[var(--shadow-soft)]"
                >
                  <AccordionTrigger className="py-4 text-left hover:no-underline">
                    <span className="flex items-center gap-3">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Icon className="size-4.5" />
                      </span>
                      <span className="font-display text-lg text-foreground">
                        <span className="text-gold-foreground/60">{i + 1}.</span> {title}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">
                    {body}
                    {contact && <ContactLinks />}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* 4 — PAYMENT SCREENSHOT PRIVACY NOTICE */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-primary p-7 text-primary-foreground shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-4">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold">
              <AlertTriangle className="size-6" />
            </span>
            <div>
              <h3 className="font-display text-2xl text-gold">Important Payment Privacy Note</h3>
              <p className="mt-2 text-sm leading-relaxed text-primary-foreground/85">
                Please upload payment screenshots only through Nongorr&apos;s official checkout
                page. Do not share sensitive payment information with unknown accounts or unofficial
                pages.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 — PRIVACY IN SIMPLE WORDS */}
      <section className="mx-auto max-w-4xl px-4 pb-14 sm:px-6">
        <div className="text-center">
          <span className="eyebrow">Plain & Simple</span>
          <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
            Privacy in Simple Words
          </h2>
          <div className="ornament-divider mx-auto mt-4 w-32" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {simpleSummary.map((text) => (
            <div
              key={text}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]"
            >
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-foreground" />
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
            Questions about your privacy?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/85">
            Our team is here to help you understand how your information is handled.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="bg-gold text-gold-foreground hover:bg-gold/90">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
                Contact on WhatsApp
              </a>
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

function ContactLinks() {
  const items = [
    {
      icon: MessageCircle,
      label: "WhatsApp",
      value: BRAND.whatsapp,
      href: `https://wa.me/${BRAND.whatsapp}`,
    },
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
