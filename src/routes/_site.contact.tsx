import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageCircle,
  Mail,
  MapPin,
  Clock,
  Facebook,
  Ruler,
  HelpCircle,
  Scissors,
  RotateCcw,
  CheckCircle2,
  Send,
  Sparkles,
  ArrowRight,
} from "lucide-react";

// TODO(backend): wire this form to a contact API / Supabase table.
// Currently the submit handler is a client-only placeholder.

export const Route = createFileRoute("/_site/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us | Nongorr Studio" },
      {
        name: "description",
        content:
          "Contact Nongorr Studio for order support, size guidance, custom size help, payment verification, delivery queries, and product information.",
      },
      { property: "og:title", content: "Contact Us | Nongorr Studio" },
      {
        property: "og:description",
        content:
          "Reach Nongorr Studio for order support, size guidance, custom orders, payment, and delivery help.",
      },
      { property: "og:url", content: "/contact" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/contact" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact Nongorr Studio",
          url: "/contact",
          description:
            "Contact Nongorr Studio for order support, size guidance, custom orders, payment and delivery help.",
        }),
      },
    ],
  }),
  component: Contact,
});

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hi Nongorr Studio! I need some help.",
)}`;

const reasons = ["Order Help", "Size Help", "Payment Help", "Return Help", "Collaboration"];

const trustBadges = [
  "Size guidance",
  "Order support",
  "Custom order help",
  "Bangladesh delivery support",
];

function Contact() {
  return (
    <div className="bg-secondary/30">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border bg-background">
        <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-gold/20 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--color-gold) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
        <span className="pointer-events-none absolute left-[12%] top-10 h-24 w-1.5 rotate-12 rounded-full bg-gradient-to-b from-gold/40 to-transparent blur-[1px]" />
        <span className="pointer-events-none absolute right-[18%] top-24 h-32 w-1.5 -rotate-12 rounded-full bg-gradient-to-b from-primary/30 to-transparent blur-[1px]" />

        <div className="relative mx-auto max-w-4xl animate-fade-in px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="eyebrow">Contact Us</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-6xl">
            We're here to help
          </h1>
          <p className="mt-2 font-display text-lg text-primary sm:text-2xl">
            যেকোনো প্রয়োজনে আমাদের সাথে যোগাযোগ করুন
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Need help with size, custom order, delivery, payment, or product details? Contact
            Nongorr Studio anytime during working hours.
          </p>
          <div className="ornament-divider mx-auto mt-6 w-40" />
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            {trustBadges.map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-card/70 px-4 py-2 text-xs font-medium text-foreground shadow-soft backdrop-blur"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-gold" />
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        {/* MAIN LAYOUT */}
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <ContactInfo />
          <ContactForm />
        </div>

        <QuickHelp />
        <SupportCta />
      </div>
    </div>
  );
}

/* --------------------------- CONTACT INFO CARDS -------------------------- */

function ContactInfo() {
  const cards = [
    {
      icon: MessageCircle,
      title: "WhatsApp Support",
      text: "Chat with us for quick help with size, order, payment, or delivery.",
      action: { label: "Chat on WhatsApp", href: whatsappHref, external: true },
    },
    {
      icon: Facebook,
      title: "Messenger",
      text: "Message us on Facebook for product details, availability, and order support.",
      action: { label: "Message on Facebook", href: BRAND.facebook, external: true },
    },
    {
      icon: Mail,
      title: "Email",
      text: "For official queries, collaboration, or order support.",
      action: { label: BRAND.email, href: `mailto:${BRAND.email}`, external: false },
    },
    {
      icon: Clock,
      title: "Support Hours",
      lines: [
        "Online support hours may vary. WhatsApp messages are reviewed when support is available.",
      ],
    },
    {
      icon: MapPin,
      title: "Location",
      lines: ["Online-based boutique brand in Bangladesh"],
      note: "We currently operate online and deliver through courier partners.",
    },
  ];

  return (
    <div className="animate-fade-in space-y-4">
      {cards.map((c) => (
        <div
          key={c.title}
          className="group rounded-2xl border border-border bg-card/80 p-5 shadow-soft backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-card"
        >
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gold/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <c.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg text-foreground">{c.title}</h3>
              {c.text && <p className="mt-1 text-sm text-muted-foreground">{c.text}</p>}
              {c.lines?.map((l) => (
                <p key={l} className="mt-1 text-sm text-muted-foreground">
                  {l}
                </p>
              ))}
              {c.note && <p className="mt-1.5 text-xs italic text-muted-foreground/80">{c.note}</p>}
              {c.action && (
                <a
                  href={c.action.href}
                  target={c.action.external ? "_blank" : undefined}
                  rel={c.action.external ? "noopener noreferrer" : undefined}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {c.action.label} <ArrowRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ CONTACT FORM ----------------------------- */

function ContactForm() {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string)?.trim() ?? "";
    const phone = (fd.get("phone") as string)?.trim() ?? "";
    const email = (fd.get("email") as string)?.trim() ?? "";
    const message = (fd.get("message") as string)?.trim() ?? "";

    const next: Record<string, string> = {};
    if (!name) next.name = "Please enter your full name.";
    if (!phone) next.phone = "Phone number is required.";
    else if (!/^01[3-9]\d{8}$/.test(phone.replace(/[\s-]/g, "")))
      next.phone = "Enter a valid Bangladesh number (e.g. 01XXXXXXXXX).";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Enter a valid email address.";
    if (!reason) next.reason = "Please choose a contact reason.";
    if (!message) next.message = "Please write a short message.";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    // TODO(backend): send { name, phone, email, reason, orderNumber, message } to API.
    setSent(true);
  }

  if (sent) {
    return (
      <div className="animate-scale-in self-start rounded-2xl border border-gold/40 bg-card p-8 text-center shadow-card sm:p-12">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="mt-5 font-display text-2xl text-foreground">Support request prepared</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          This demo form did not send your message. Contact Nongorr through WhatsApp or email to
          submit your request.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild variant="secondary">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4" /> Chat on WhatsApp
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`mailto:${BRAND.email}`}>
              <Mail className="mr-2 h-4 w-4" /> Email us
            </a>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSent(false);
              setErrors({});
            }}
          >
            Send another message
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="animate-fade-in space-y-4 self-start rounded-2xl border border-border bg-card p-6 shadow-soft sm:p-8"
    >
      <div>
        <h2 className="font-display text-2xl text-foreground">Send us a message</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the form and our boutique team will reply soon.
        </p>
      </div>

      <Field label="Full Name" error={errors.name}>
        <Input name="name" placeholder="Enter your full name" maxLength={100} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone Number" error={errors.phone}>
          <Input name="phone" type="tel" placeholder="01XXXXXXXXX" maxLength={20} />
        </Field>
        <Field label="Email Address (optional)" error={errors.email}>
          <Input name="email" type="email" placeholder="you@example.com" maxLength={255} />
        </Field>
      </div>

      <Field label="Contact Reason" error={errors.reason}>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="bg-background">
            <SelectValue placeholder="Select a reason" />
          </SelectTrigger>
          <SelectContent>
            {reasons.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Order Number (optional)">
        <Input name="orderNumber" placeholder="Enter order number if available" maxLength={40} />
      </Field>

      <Field label="Message" error={errors.message}>
        <Textarea name="message" rows={5} placeholder="Write your message here…" maxLength={1000} />
      </Field>

      <Button
        type="submit"
        size="lg"
        className="w-full bg-gradient-to-r from-primary to-primary/80 transition-all hover:shadow-card"
      >
        <Send className="mr-2 h-4 w-4" /> Prepare Support Request
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        This demo form does not send your message to a server. Use WhatsApp or email to reach us.
      </p>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/* ------------------------------ QUICK HELP ------------------------------- */

function QuickHelp() {
  const items = [
    {
      icon: Ruler,
      title: "Need size help?",
      text: "Check our custom and fixed size guide before ordering.",
      label: "View Size Guide",
      to: "/size-guide",
    },
    {
      icon: HelpCircle,
      title: "Have order questions?",
      text: "Find answers about payment, delivery, return, and exchange.",
      label: "View FAQ",
      to: "/faq",
    },
    {
      icon: Scissors,
      title: "Custom size order?",
      text: "Learn how to submit your body measurements correctly.",
      label: "Custom Size Guide",
      to: "/size-guide",
    },
    {
      icon: RotateCcw,
      title: "Return or exchange?",
      text: "Read our return and exchange policy before submitting a request.",
      label: "Return Policy",
      to: "/return-policy",
    },
  ] as const;

  return (
    <section className="mt-16">
      <div className="text-center">
        <span className="eyebrow">Quick Help</span>
        <h2 className="mt-2 font-display text-3xl text-foreground">Find answers faster</h2>
        <div className="ornament-divider mx-auto mt-3 w-32" />
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.title}
            className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-card"
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-gold/15 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <it.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-display text-lg text-foreground">{it.title}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{it.text}</p>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link to={it.to}>{it.label}</Link>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ SUPPORT CTA ------------------------------ */

function SupportCta() {
  return (
    <section className="relative mt-16 overflow-hidden rounded-3xl border border-gold/40 bg-gradient-to-br from-primary to-primary/80 p-8 text-center text-primary-foreground shadow-card sm:p-12">
      <Sparkles className="pointer-events-none absolute right-6 top-6 h-10 w-10 text-gold/40" />
      <span className="pointer-events-none absolute -left-6 bottom-0 h-28 w-1.5 rotate-12 rounded-full bg-gradient-to-b from-gold/40 to-transparent" />
      <h2 className="font-display text-3xl sm:text-4xl">Need urgent help?</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm text-primary-foreground/85">
        For faster support, contact us on WhatsApp with your name, phone number, and order number if
        available.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" variant="secondary">
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Chat on WhatsApp
          </a>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <Link to="/faq">Visit FAQ</Link>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <Link to="/size-guide">View Size Guide</Link>
        </Button>
      </div>
    </section>
  );
}
