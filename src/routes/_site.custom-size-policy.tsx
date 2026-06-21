import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero } from "@/components/PageHero";
import { PremiumCard } from "@/components/PremiumCard";
import { Button } from "@/components/ui/button";
import {
  MousePointerClick,
  Ruler,
  Clock,
  AlertTriangle,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { BRAND } from "@/lib/brand";

export const Route = createFileRoute("/_site/custom-size-policy")({
  head: () => ({
    meta: [
      { title: "Custom Size Policy · Nongorr" },
      {
        name: "description",
        content:
          "Learn how Nongorr's custom-size kurti tailoring works, measurement guidelines and our made-to-order policy.",
      },
    ],
    links: [{ rel: "canonical", href: "/custom-size-policy" }],
  }),
  component: CustomSizePolicy,
});

const steps = [
  {
    icon: MousePointerClick,
    title: "Choose Custom Size",
    body: 'Select "Custom Size" on any eligible kurti product page.',
  },
  {
    icon: Ruler,
    title: "Enter measurements",
    body: "Add your six measurements: bust, waist, hip, shoulder, sleeve and length.",
  },
  {
    icon: Clock,
    title: "We tailor & deliver",
    body: "Made to order in 5–10 working days, then shipped to your door.",
  },
];

function CustomSizePolicy() {
  return (
    <div>
      <PageHero
        eyebrow="Tailoring"
        title="Custom Size Policy"
        description="Kurti made to your exact measurements, crafted just for you."
      />

      <div className="mx-auto max-w-4xl space-y-12 px-4 py-12 sm:px-6">
        <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
          At Nongorr, we offer custom-size tailoring on selected kurti so every piece fits you
          beautifully. Here's how the made-to-order process works.
        </p>

        {/* How it works steps */}
        <div>
          <h2 className="mb-5 text-center font-display text-2xl text-foreground">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <PremiumCard key={s.title} hover className="text-center">
                <div className="relative mb-4">
                  <span className="absolute -top-1 left-1/2 -translate-x-1/2 font-display text-5xl text-gold/15">
                    {i + 1}
                  </span>
                  <div className="relative mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                    <s.icon className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="font-display text-lg text-foreground">{s.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </PremiumCard>
            ))}
          </div>
        </div>

        {/* Custom-size charge callout */}
        <PremiumCard accent className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <p className="text-sm text-muted-foreground">
            A small <strong className="text-foreground">custom-size charge</strong> (shown on each
            product) is added to cover the extra tailoring work. The total updates live as you
            choose custom fit.
          </p>
        </PremiumCard>

        {/* Important notes — warning callout */}
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="flex items-center gap-2 font-display text-xl text-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" /> Important to know
          </h2>
          <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-destructive">•</span> Please measure carefully — we craft
              exactly to the measurements you provide.
            </li>
            <li className="flex gap-2">
              <span className="text-destructive">•</span>{" "}
              <strong className="text-foreground">
                Custom-size items are non-returnable and non-exchangeable
              </strong>{" "}
              unless there is a manufacturing defect.
            </li>
            <li className="flex gap-2">
              <span className="text-destructive">•</span> Made-to-order pieces may take longer than
              ready-size items during peak seasons.
            </li>
          </ul>
        </div>

        {/* CTAs */}
        <div className="grid gap-4 sm:grid-cols-2">
          <PremiumCard hover className="flex flex-col items-start gap-3">
            <Ruler className="h-6 w-6 text-primary" />
            <h3 className="font-display text-lg text-foreground">Not sure how to measure?</h3>
            <p className="text-sm text-muted-foreground">
              Follow our step-by-step size guide with a visual measurement chart.
            </p>
            <Button asChild variant="outline" className="mt-auto">
              <Link to="/size-guide">Open size guide</Link>
            </Button>
          </PremiumCard>

          <PremiumCard hover className="flex flex-col items-start gap-3">
            <MessageCircle className="h-6 w-6 text-success" />
            <h3 className="font-display text-lg text-foreground">Need help measuring?</h3>
            <p className="text-sm text-muted-foreground">
              Message us on WhatsApp and we'll guide you measurement by measurement.
            </p>
            <Button asChild className="mt-auto">
              <a href={`https://wa.me/${BRAND.whatsapp}`} target="_blank" rel="noreferrer">
                Chat on WhatsApp
              </a>
            </Button>
          </PremiumCard>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Have more questions? Visit our{" "}
          <Link to="/faq" className="font-medium text-primary underline-offset-4 hover:underline">
            FAQ page
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
