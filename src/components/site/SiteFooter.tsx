import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import type { PublicSettings } from "@/lib/settings.schema";
import { availableMethods } from "@/lib/checkout-shared";
import { PRODUCT_CATEGORIES } from "@/lib/categories";
import {
  FacebookIcon,
  InstagramIcon,
  WhatsappIcon,
  TiktokIcon,
} from "@/components/site/social-icons";

import {
  MessageCircle,
  Mail,
  MapPin,
  Clock,
  Wallet,
  Truck,
  Ruler,
  Headphones,
  ChevronDown,
  ArrowUp,
  Package,
  Sparkles,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

/*
 * Nongorr premium customer-facing footer.
 * UI/UX only — all actions are frontend mock.
 * Contact/social links come from admin DB settings (with the static brand as a
 * fallback) — see the `settings` prop.
 * TODO: connect newsletter subscription to backend.
 * TODO: load real payment/courier configuration from admin.
 */

type FooterLink = {
  label: string;
  to?: string;
  search?: Record<string, string>;
  placeholder?: boolean;
};

const shopLinks: FooterLink[] = [
  // Physical categories from the shared category source (no local duplicate array).
  ...PRODUCT_CATEGORIES.map((c) => ({
    label: c.label,
    to: "/shop",
    search: { category: c.category },
  })),
  // Discovery links are filters, not physical categories.
  { label: "New Arrivals", to: "/shop", search: { filter: "new-arrivals" } },
  { label: "Best Sellers", to: "/shop", search: { filter: "best-sellers" } },
];

const careLinks: FooterLink[] = [
  { label: "Track Order", to: "/track" },
  { label: "Size Guide", to: "/size-guide" },
  { label: "Custom Size Policy", to: "/custom-size-policy" },
  { label: "How to Order", to: "/faq" },
  { label: "Delivery Policy", to: "/delivery-policy" },
  { label: "Return & Exchange Policy", to: "/return-policy" },
  { label: "FAQ", to: "/faq" },
  { label: "Contact Us", to: "/contact" },
];

const policyLinks: FooterLink[] = [
  { label: "Privacy Policy", to: "/privacy-policy" },
  { label: "Terms & Conditions", to: "/terms" },
  { label: "Return Policy", to: "/return-policy" },
  { label: "Payment Policy", to: "/payment-policy" },
  { label: "Shipping Policy", to: "/delivery-policy" },
  { label: "Cookie Policy", to: "/cookie-policy" },
  { label: "Authenticity Policy", to: "/authenticity-policy" },
];

const trustCards = [
  {
    icon: Wallet,
    title: "Manual bKash Payment",
    text: "Simple startup-friendly payment verification",
  },
  { icon: Truck, title: "Nationwide Delivery", text: "Inside and outside Dhaka" },
  { icon: Ruler, title: "Custom Size Available", text: "For selected kurti items" },
  { icon: Headphones, title: "WhatsApp Support", text: "Friendly help before and after order" },
];

/* ---------------- Footer link list (animated underline) ---------------- */
function FooterLinkItem({ link }: { link: FooterLink }) {
  const cls =
    "group inline-flex w-fit items-center text-sm text-primary-foreground/75 transition-colors hover:text-gold";
  const underline = (
    <span className="relative">
      {link.label}
      <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-gold transition-transform duration-300 group-hover:origin-left group-hover:scale-x-100" />
    </span>
  );
  if (link.placeholder) {
    // TODO: create dedicated route for this policy and replace button with Link.
    return (
      <button type="button" className={cls} aria-label={`${link.label} (coming soon)`}>
        {underline}
      </button>
    );
  }
  return (
    <Link to={link.to!} search={link.search as never} className={cls}>
      {underline}
    </Link>
  );
}

/* ---------------- Mobile accordion column ---------------- */
function MobileColumn({ title, links }: { title: string; links: FooterLink[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gold/15">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-4 text-left font-display text-lg text-gold"
      >
        {title}
        <ChevronDown className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`grid overflow-hidden transition-all duration-300 ${
          open ? "grid-rows-[1fr] pb-4" : "grid-rows-[0fr]"
        }`}
      >
        <ul className="flex min-h-0 flex-col gap-3">
          {links.map((l) => (
            <li key={l.label}>
              <FooterLinkItem link={l} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SiteFooter({ settings }: { settings?: PublicSettings | null }) {
  const navigate = useNavigate();

  // Contact/social values: admin-configured (DB) first, static brand as fallback.
  const WHATSAPP = settings?.whatsapp || BRAND.whatsapp || "";
  const EMAIL = settings?.contact_email || BRAND.email || "hello@nongorr.com";
  const waLink = (msg: string) =>
    WHATSAPP ? `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}` : "#";
  const socials = [
    {
      icon: FacebookIcon,
      label: "Visit Nongorr on Facebook",
      href: settings?.facebook || BRAND.facebook || "#",
      disabled: false,
    },
    {
      icon: InstagramIcon,
      label: "Visit Nongorr on Instagram",
      href: settings?.instagram || BRAND.instagram || "#",
      disabled: false,
    },
    {
      icon: WhatsappIcon,
      label: "Message Nongorr on WhatsApp",
      href: waLink("Hi Nongorr! I found you through your website 💕"),
      disabled: !WHATSAPP,
    },
    {
      icon: TiktokIcon,
      label: settings?.tiktok ? "Visit Nongorr on TikTok" : "TikTok — coming soon",
      href: settings?.tiktok || "#",
      disabled: !settings?.tiktok,
    },
  ];

  // Newsletter mock state
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [waToggle, setWaToggle] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  // Quick-track order number (prefills the /track page)
  const [orderId, setOrderId] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const phoneOk = /^[0-9+\-\s]{6,}$/.test(phone.trim());
    if (!emailOk || (waToggle && !phoneOk)) {
      setStatus("error");
      return;
    }
    // Frontend-only demo: persist the validated preference to this browser only.
    // Nothing is sent to a server. Disclosed in the Cookie Policy.
    try {
      localStorage.setItem(
        "nongorr_newsletter_demo",
        JSON.stringify({
          version: 1,
          email: email.trim(),
          whatsapp: waToggle ? phone.trim() : "",
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      setStatus("error");
      return;
    }
    setStatus("success");
    setEmail("");
    setPhone("");
  };

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    const no = orderId.trim();
    // Prefill the order number on the track page; the customer adds their
    // tracking code there (guest tracking needs order number + code).
    navigate({ to: "/track", search: no ? { o: no } : {} });
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <footer className="relative mt-20">
      {/* shimmer top border */}
      <div aria-hidden className="h-px w-full" style={{ background: "var(--gradient-gold)" }} />

      {/* 1 — PRE-FOOTER CTA / NEWSLETTER */}
      <section className="site-footer-newsletter relative isolate overflow-hidden text-primary-foreground">
        <div className="relative mx-auto max-w-3xl px-4 py-14 text-center sm:px-6">
          <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
            Stay Connected
          </span>
          <h2 className="mt-3 font-display text-3xl text-gold sm:text-4xl">
            Be the First to Discover Nongorr Drops
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
            Get updates on new kurtis, custom-size releases, festive collections, beauty items, and
            exclusive offers.
          </p>

          {status === "success" ? (
            <div className="mx-auto mt-7 flex max-w-md animate-scale-in items-center justify-center gap-2 rounded-2xl border border-gold/40 bg-gold/15 px-5 py-4 text-gold">
              <CheckCircle2 className="size-5" />
              <span className="font-medium">
                Demo saved on this device. No subscription was sent to a server.
              </span>
            </div>
          ) : (
            <form onSubmit={handleSubscribe} className="mx-auto mt-7 max-w-md space-y-3 text-left">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor="nl-email" className="sr-only">
                  Email address
                </label>
                <Input
                  id="nl-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setStatus("idle");
                  }}
                  placeholder="Your email address"
                  className="border-gold/30 bg-primary-foreground/95 text-foreground placeholder:text-muted-foreground"
                />
                <Button
                  type="submit"
                  className="shrink-0 bg-gold text-gold-foreground hover:bg-gold/90"
                >
                  Join the Circle
                </Button>
              </div>

              {waToggle && (
                <div className="animate-fade-in">
                  <label htmlFor="nl-phone" className="sr-only">
                    WhatsApp number
                  </label>
                  <Input
                    id="nl-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setStatus("idle");
                    }}
                    placeholder="WhatsApp number (e.g. 01XXXXXXXXX)"
                    className="border-gold/30 bg-primary-foreground/95 text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-xs text-primary-foreground/80">
                <input
                  type="checkbox"
                  checked={waToggle}
                  onChange={(e) => setWaToggle(e.target.checked)}
                  className="size-3.5 accent-[oklch(0.7_0.1_80)]"
                />
                Prefer WhatsApp updates?
              </label>

              {status === "error" && (
                <p className="flex items-center gap-1.5 text-xs text-gold">
                  <AlertCircle className="size-3.5" />
                  Please enter a valid email{waToggle ? " and WhatsApp number" : ""}. If this keeps
                  happening, your browser storage may be unavailable.
                </p>
              )}
            </form>
          )}

          <p className="mt-4 text-xs text-primary-foreground/55">
            Demo only — saved on this device, nothing is sent to a server.
          </p>
        </div>
      </section>

      {/* MAIN FOOTER — continuous premium surface (no logo watermark) */}
      <div className="site-footer-bg relative isolate overflow-hidden text-primary-foreground">
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6">
          {/* 3 — TRUST STRIP */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {trustCards.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-2xl border border-gold/15 bg-primary-foreground/[0.04] p-4 transition-all duration-200 hover:-translate-y-1 hover:border-gold/40"
              >
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <Icon className="size-4.5" />
                </span>
                <h3 className="mt-3 font-display text-base text-gold">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-primary-foreground/65">{text}</p>
              </div>
            ))}
          </div>

          <div className="my-10 h-px w-full bg-gold/15" />

          {/* 2 — COLUMNS (desktop) */}
          <div className="hidden gap-10 lg:grid lg:grid-cols-[1.6fr_1fr_1.1fr_1fr_1.3fr]">
            {/* Brand */}
            <div className="space-y-4">
              <Logo variant="light" />
              <p className="max-w-xs text-sm leading-relaxed text-primary-foreground/70">
                A premium women&apos;s boutique rooted in Bangladeshi craft, custom-fit clothing,
                and timeless feminine elegance.
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-gold/80">
                Founded by Miskatul Afrin Anika
              </p>
              <div className="flex gap-2">
                {socials.map(({ icon: Icon, label, href, disabled }) =>
                  disabled ? (
                    <span
                      key={label}
                      aria-disabled="true"
                      aria-label={label}
                      title="TikTok — coming soon"
                      className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-full border border-gold/15 text-primary-foreground/30"
                    >
                      <Icon className="size-4" />
                    </span>
                  ) : (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      className="inline-flex size-9 items-center justify-center rounded-full border border-gold/25 text-primary-foreground/80 transition-all duration-200 hover:scale-110 hover:border-gold hover:text-gold hover:shadow-[0_0_14px_-2px_oklch(0.7_0.1_80/0.6)]"
                    >
                      <Icon className="size-4" />
                    </a>
                  ),
                )}
              </div>
            </div>

            {/* Shop */}
            <div>
              <h4 className="mb-4 font-display text-lg text-gold">Shop</h4>
              <ul className="flex flex-col gap-3">
                {shopLinks.map((l) => (
                  <li key={l.label}>
                    <FooterLinkItem link={l} />
                  </li>
                ))}
              </ul>
            </div>

            {/* Customer Care */}
            <div>
              <h4 className="mb-4 font-display text-lg text-gold">Customer Care</h4>
              <ul className="flex flex-col gap-3">
                {careLinks.map((l) => (
                  <li key={l.label}>
                    <FooterLinkItem link={l} />
                  </li>
                ))}
              </ul>
            </div>

            {/* Policies */}
            <div>
              <h4 className="mb-4 font-display text-lg text-gold">Policies</h4>
              <ul className="flex flex-col gap-3">
                {policyLinks.map((l) => (
                  <li key={l.label}>
                    <FooterLinkItem link={l} />
                  </li>
                ))}
              </ul>
            </div>

            {/* Contact / Need Help */}
            <div className="space-y-3">
              <h4 className="mb-1 font-display text-lg text-gold">Need Help?</h4>
              <a
                href={waLink("Hi Nongorr! I need help with shopping/order support 🛍️")}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary-foreground/80 transition-colors hover:text-gold"
              >
                <MessageCircle className="size-4 shrink-0 text-gold" />
                {WHATSAPP ? `+${WHATSAPP}` : "WhatsApp support"}
              </a>
              <a
                href={`mailto:${EMAIL}`}
                className="flex items-center gap-2 text-sm text-primary-foreground/80 transition-colors hover:text-gold"
              >
                <Mail className="size-4 shrink-0 text-gold" />
                {EMAIL}
              </a>
              <p className="flex items-center gap-2 text-sm text-primary-foreground/80">
                <Clock className="size-4 shrink-0 text-gold" />
                10:00 AM – 10:00 PM
              </p>
              <p className="flex items-center gap-2 text-sm text-primary-foreground/80">
                <MapPin className="size-4 shrink-0 text-gold" />
                Online boutique · Bangladesh
              </p>
              <Button asChild className="mt-1 w-full bg-gold text-gold-foreground hover:bg-gold/90">
                <a
                  href={waLink("Hi Nongorr! I need help with shopping/order support 🛍️")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="size-4" />
                  Chat on WhatsApp
                </a>
              </Button>
            </div>
          </div>

          {/* MOBILE: brand + accordion */}
          <div className="lg:hidden">
            <div className="space-y-4">
              <Logo variant="light" />
              <p className="text-sm leading-relaxed text-primary-foreground/70">
                A premium women&apos;s boutique rooted in Bangladeshi craft, custom-fit clothing,
                and timeless feminine elegance.
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-gold/80">
                Founded by Miskatul Afrin Anika
              </p>
              <div className="flex gap-2">
                {socials.map(({ icon: Icon, label, href, disabled }) =>
                  disabled ? (
                    <span
                      key={label}
                      aria-disabled="true"
                      aria-label={label}
                      title="TikTok — coming soon"
                      className="inline-flex size-10 cursor-not-allowed items-center justify-center rounded-full border border-gold/15 text-primary-foreground/30"
                    >
                      <Icon className="size-4" />
                    </span>
                  ) : (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      className="inline-flex size-10 items-center justify-center rounded-full border border-gold/25 text-primary-foreground/80 transition-all hover:border-gold hover:text-gold"
                    >
                      <Icon className="size-4" />
                    </a>
                  ),
                )}
              </div>
            </div>

            <div className="mt-6">
              <MobileColumn title="Shop" links={shopLinks} />
              <MobileColumn title="Customer Care" links={careLinks} />
              <MobileColumn title="Policies" links={policyLinks} />
            </div>

            <div className="mt-6 space-y-3 rounded-2xl border border-gold/15 bg-primary-foreground/[0.04] p-5">
              <h4 className="font-display text-lg text-gold">Need Help?</h4>
              <a
                href={waLink("Hi Nongorr! I need help with shopping/order support 🛍️")}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary-foreground/80"
              >
                <MessageCircle className="size-4 shrink-0 text-gold" />
                {WHATSAPP ? `+${WHATSAPP}` : "WhatsApp support"}
              </a>
              <a
                href={`mailto:${EMAIL}`}
                className="flex items-center gap-2 text-sm text-primary-foreground/80"
              >
                <Mail className="size-4 shrink-0 text-gold" />
                {EMAIL}
              </a>
              <p className="flex items-center gap-2 text-sm text-primary-foreground/80">
                <Clock className="size-4 shrink-0 text-gold" />
                10:00 AM – 10:00 PM
              </p>
              <Button asChild className="w-full bg-gold text-gold-foreground hover:bg-gold/90">
                <a
                  href={waLink("Hi Nongorr! I need help with shopping/order support 🛍️")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="size-4" /> Chat on WhatsApp
                </a>
              </Button>
            </div>
          </div>

          {/* 4 — QUICK HELP */}
          <div className="mt-10 grid gap-4 rounded-2xl border border-gold/15 bg-primary-foreground/[0.04] p-6 md:grid-cols-[auto_1fr] md:items-center">
            <div className="flex items-center gap-2 font-display text-xl text-gold">
              <Package className="size-5" /> Quick Help
            </div>
            <div className="grid gap-4 sm:grid-cols-[1.4fr_auto_auto] sm:items-center">
              <form onSubmit={handleTrack} className="flex gap-2">
                <label htmlFor="quick-track" className="sr-only">
                  Order number
                </label>
                <Input
                  id="quick-track"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  placeholder="Enter order number"
                  className="border-gold/30 bg-primary-foreground/95 text-foreground placeholder:text-muted-foreground"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="shrink-0 border-gold/40 bg-transparent text-gold hover:bg-gold/10 hover:text-gold"
                >
                  Track
                </Button>
              </form>
              <Link
                to="/size-guide"
                className="inline-flex items-center gap-1.5 text-sm text-primary-foreground/80 transition-colors hover:text-gold"
              >
                <Ruler className="size-4" /> Need size help?
              </Link>
              <a
                href={waLink("Hi Nongorr! I need help choosing size.")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary-foreground/80 transition-colors hover:text-gold"
              >
                <HelpCircle className="size-4" /> Ask on WhatsApp
              </a>
            </div>
          </div>

          {/* 5 — PAYMENT & DELIVERY ROW */}
          <div className="mt-8 flex flex-col items-center gap-3 text-center text-xs text-primary-foreground/60 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-5">
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="size-3.5 text-gold" /> bKash Manual Payment
            </span>
            <span className="hidden sm:inline text-gold/40">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Truck className="size-3.5 text-gold" /> Cash on Delivery
              {availableMethods(settings ?? null).cod ? "" : " (coming soon)"}
            </span>
            <span className="hidden sm:inline text-gold/40">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Package className="size-3.5 text-gold" /> SteadFast · Pathao courier partners
            </span>
            <span className="hidden sm:inline text-gold/40">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-gold" /> Dhaka ৳80 · Major Cities ৳100 · Outside
              Dhaka ৳130
            </span>
          </div>
        </div>

        {/* 6 — BOTTOM BAR */}
        <div className="border-t border-gold/15 bg-[oklch(0.2_0.05_20)]">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-5 text-xs text-primary-foreground/60 sm:px-6 md:flex-row md:justify-between">
            <p>© 2026 Nongorr Studio. All rights reserved.</p>
            <p className="inline-flex items-center gap-1.5 text-gold/80">
              <Sparkles className="size-3.5" /> Handcrafted with love in Bangladesh
            </p>
            <div className="flex items-center gap-4">
              <Link to="/privacy-policy" className="transition-colors hover:text-gold">
                Privacy
              </Link>
              <span className="text-gold/30">·</span>
              <Link to="/terms" className="transition-colors hover:text-gold">
                Terms
              </Link>
              <span className="text-gold/30">·</span>
              <Link to="/return-policy" className="transition-colors hover:text-gold">
                Returns
              </Link>
              <button
                type="button"
                onClick={scrollTop}
                aria-label="Back to top"
                className="ml-1 inline-flex size-9 items-center justify-center rounded-full bg-gold text-gold-foreground transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_0_16px_-2px_oklch(0.7_0.1_80/0.7)]"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
