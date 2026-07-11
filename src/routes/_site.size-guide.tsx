import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import sizeChart from "@/assets/size-chart.webp";
import { PremiumCard } from "@/components/PremiumCard";
import { SizeChartViewer } from "@/components/SizeChartViewer";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Ruler,
  Scissors,
  MessageCircle,
  Sparkles,
  ShoppingBag,
  HeartHandshake,
  CheckCircle2,
  Info,
  ArrowRight,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { getSizeCharts } from "@/lib/sizes.api";
import { toGuideChart, type PublicSizeChart } from "@/lib/sizes-shared";

// Fixed-size charts are CMS-managed since Stage 6 P5 (admin → Size Settings);
// the arrays below are the static FALLBACK used only when no chart is live.

export const Route = createFileRoute("/_site/size-guide")({
  head: () => ({
    meta: [
      { title: "Size Guide | Nongorr Studio" },
      {
        name: "description",
        content:
          "Find your perfect Nongorr Studio size. View custom measurement instructions and fixed size charts for kurti, three piece, girls dress, saree, and more.",
      },
      { property: "og:title", content: "Size Guide | Nongorr Studio" },
      {
        property: "og:description",
        content:
          "Custom measurement instructions and fixed size charts for kurti, three piece, girls dress and saree.",
      },
      { property: "og:url", content: "/size-guide" },
    ],
    links: [{ rel: "canonical", href: "/size-guide" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Should I give body measurement or dress measurement?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "For custom size, please give body measurement. For fixed size, compare our chart with a well-fitting dress.",
              },
            },
            {
              "@type": "Question",
              name: "Can I order custom size?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Custom size is available only for selected products where the option is shown.",
              },
            },
            {
              "@type": "Question",
              name: "What if I am between two sizes?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Choose the larger size for comfort or contact support for help.",
              },
            },
          ],
        }),
      },
    ],
  }),
  // CMS charts (Stage 6 P5); the hardcoded arrays below stay as the fallback.
  loader: () => getSizeCharts(),
  component: SizeGuide,
});

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hi Nongorr! I need help choosing my size.",
)}`;

const measurements = [
  [
    "Bust",
    "Measure around the fullest part of your bust. Keep the tape straight and comfortable, not too tight.",
  ],
  ["Waist", "Measure around your natural waistline, usually the narrowest part of your waist."],
  ["Hip", "Measure around the fullest part of your hip while standing naturally."],
  ["Shoulder", "Measure from one shoulder edge to the other shoulder edge across the back."],
  ["Sleeve Length", "Measure from the shoulder point down to your preferred sleeve length."],
  [
    "Dress Length",
    "Measure from the highest shoulder point down to your preferred kurti or dress length. This is dress length, not full body height.",
  ],
  [
    "Armhole / Round Sleeve",
    "Measure around the upper arm/armhole area if the product requires a more fitted sleeve.",
  ],
  ["Bicep", "Measure around the fullest part of your upper arm for comfortable sleeve fitting."],
  ["Neck", "Measure around the base of your neck only if the design requires neck measurement."],
];

const customTips = [
  "Use inch tape only.",
  "Stand naturally while measuring.",
  "Do not make the tape too tight.",
  "Take help from another person for better accuracy.",
  "Double-check bust, waist, hip, shoulder, sleeve, and dress length.",
  "For fitted outfits, contact support before ordering.",
  "Small handmade variation of 0.5–1 inch may happen.",
];

const kurtiChart = {
  cols: ["Size", "Bust", "Waist", "Hip", "Shoulder", "Sleeve", "Length"],
  rows: [
    ["XS", "32", "28", "36", "13.5", "17", "42"],
    ["S", "34", "30", "38", "14", "17.5", "42"],
    ["M", "36", "32", "40", "14.5", "18", "43", "popular"],
    ["L", "38", "34", "42", "15", "18", "44", "popular"],
    ["XL", "40", "36", "44", "15.5", "18.5", "44"],
    ["XXL", "42", "38", "46", "16", "19", "45"],
    ["3XL", "44", "40", "48", "16.5", "19", "45"],
  ],
};

const threePieceChart = {
  cols: ["Size", "Bust", "Waist", "Hip", "Shoulder", "Kameez Length"],
  rows: [
    ["S", "34", "30", "38", "14", "42"],
    ["M", "36", "32", "40", "14.5", "43", "popular"],
    ["L", "38", "34", "42", "15", "44", "popular"],
    ["XL", "40", "36", "44", "15.5", "44"],
    ["XXL", "42", "38", "46", "16", "45"],
  ],
};

const girlsChart = {
  cols: ["Age", "Chest", "Waist", "Dress Length"],
  rows: [
    ["2–3 Years", "22", "20", "22"],
    ["4–5 Years", "24", "22", "26"],
    ["6–7 Years", "26", "24", "30"],
    ["8–9 Years", "28", "26", "34"],
    ["10–11 Years", "30", "28", "38"],
    ["12–13 Years", "32", "30", "40"],
  ],
};

type Chart = { cols: string[]; rows: (string[] | readonly string[])[] };

type CategoryEntry = {
  id: string;
  label: string;
  chart: Chart | null;
  measureLabel: string;
  unit: "in" | "cm";
  note?: string | null;
};

/** Static fallback — used only when no CMS chart is live. */
const FALLBACK_CATEGORIES: CategoryEntry[] = [
  { id: "kurti", label: "Kurti", chart: kurtiChart, measureLabel: "Bust", unit: "in" },
  {
    id: "three-piece",
    label: "Three Piece",
    chart: threePieceChart,
    measureLabel: "Bust",
    unit: "in",
  },
  { id: "girls", label: "Girls Dress", chart: girlsChart, measureLabel: "Chest", unit: "in" },
  { id: "saree", label: "Saree", chart: null, measureLabel: "", unit: "in" },
];

/** CMS charts → category entries; saree keeps its prose section as a chip. */
function chartCategoriesFrom(db: PublicSizeChart[]): CategoryEntry[] {
  if (db.length === 0) return FALLBACK_CATEGORIES;
  const list: CategoryEntry[] = db.map((c) => ({
    id: c.slug,
    label: c.name,
    chart: toGuideChart(c),
    measureLabel: c.helper_column ?? "",
    unit: c.unit,
    note: c.note,
  }));
  if (!list.some((c) => c.id === "saree")) {
    list.push({ id: "saree", label: "Saree", chart: null, measureLabel: "", unit: "in" });
  }
  return list;
}

function SizeGuide() {
  const dbCharts = Route.useLoaderData();
  const categories = chartCategoriesFrom(dbCharts);
  const [tab, setTab] = useState<"custom" | "fixed">("custom");
  const [activeCat, setActiveCat] = useState<string>(categories[0]?.id ?? "kurti");

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
        {/* floating ribbon shapes */}
        <span className="pointer-events-none absolute left-[12%] top-10 h-24 w-1.5 rotate-12 rounded-full bg-gradient-to-b from-gold/40 to-transparent blur-[1px]" />
        <span className="pointer-events-none absolute right-[18%] top-24 h-32 w-1.5 -rotate-12 rounded-full bg-gradient-to-b from-primary/30 to-transparent blur-[1px]" />

        <div className="relative mx-auto max-w-4xl animate-fade-in px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="eyebrow">Boutique Fit Guide</span>
          <h1 className="mt-3 font-display text-4xl text-foreground sm:text-6xl">
            Find Your Perfect Fit
          </h1>
          <p className="mt-2 font-display text-xl text-primary sm:text-2xl">
            সঠিক মাপ নির্বাচন করুন
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Choose a fixed size or submit your custom measurements for selected handmade outfits.
          </p>
          <div className="ornament-divider mx-auto mt-6 w-40" />

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {[
              [Ruler, "Easy measurement guide"],
              [Scissors, "Custom size available"],
              [HeartHandshake, "Boutique fit support"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof Ruler;
              return (
                <span
                  key={text as string}
                  className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-card/70 px-4 py-2 text-xs font-medium text-foreground shadow-soft backdrop-blur"
                >
                  <I className="h-3.5 w-3.5 text-gold" />
                  {text as string}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* TAB SWITCHER */}
      <div className="site-sticky-under-header sticky z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
          <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-secondary/60 p-1">
            {(
              [
                ["custom", "Custom Size", Scissors],
                ["fixed", "Fixed Size Chart", Ruler],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-300",
                  tab === id
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 pb-28 sm:px-6 lg:py-16 lg:pb-16">
        {tab === "custom" ? (
          <CustomSection />
        ) : (
          <FixedSection activeCat={activeCat} setActiveCat={setActiveCat} categories={categories} />
        )}

        {/* SIZE HELPER + FIT RECOMMENDATION + FAQ shared */}
        <SizeStartingPointHelper categories={categories} />
        <FitRecommendation />
        <FaqSection />
      </div>

      {/* Mobile sticky CTA — sits left of the global WhatsApp bubble */}
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="size-guide-mobile-cta fixed z-30 lg:hidden"
      >
        <span className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-card">
          <MessageCircle className="h-4 w-4 shrink-0" /> Need size help? Chat with us
        </span>
      </a>
    </div>
  );
}

/* ----------------------------- CUSTOM SECTION ---------------------------- */

function CustomSection() {
  return (
    <div className="animate-fade-in space-y-10">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Illustration */}
        <PremiumCard accent className="order-1 h-fit lg:sticky lg:top-32">
          <SizeChartViewer src={sizeChart} alt="Nongorr kurti measurement illustration" />
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Tap the illustration for a larger, step-by-step measurement guide.
            </p>
            <MeasurementModalButton />
          </div>
        </PremiumCard>

        {/* Instructions */}
        <div className="order-2 space-y-5">
          <div>
            <span className="eyebrow">Custom Size</span>
            <h2 className="mt-2 font-display text-3xl text-foreground">Custom Size Measurements</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              For selected handmade outfits, you can submit your own body measurements. Please
              measure carefully in inches. Our team will use your measurements to prepare the outfit
              with proper comfort allowance.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <p className="text-sm leading-relaxed text-foreground">
              Please provide <strong>body measurements, not garment measurements</strong>. Do not
              add extra loose margin yourself unless our team asks. We will handle the fitting
              allowance during production.
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-2">
            {measurements.map(([title, text], i) => (
              <AccordionItem
                key={title}
                value={title}
                className="overflow-hidden rounded-2xl border border-border bg-card px-4 shadow-soft transition-colors data-[state=open]:border-gold/50"
              >
                <AccordionTrigger className="py-4 hover:no-underline">
                  <span className="flex items-center gap-3 text-left">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <span className="font-medium text-foreground">{title}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-4 pl-11 text-sm text-muted-foreground">
                  {text}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>

      {/* Tips */}
      <PremiumCard accent className="bg-card">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-gold" />
          <h3 className="font-display text-2xl text-foreground">Before submitting custom size</h3>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {customTips.map((tip) => (
            <li key={tip} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              {tip}
            </li>
          ))}
        </ul>
      </PremiumCard>

      {/* CTA */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-6 text-center text-primary-foreground sm:p-10">
        <h3 className="font-display text-2xl sm:text-3xl">Need help with measurement?</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-primary-foreground/85">
          If you are confused about size, send us your height, weight, usual size, and preferred
          fit. Our team will guide you.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
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
            <Link to="/shop">
              <ShoppingBag className="mr-2 h-4 w-4" /> View Product
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function MeasurementModalButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Maximize2 className="h-3.5 w-3.5" /> Open Measurement Guide
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">How to Measure</DialogTitle>
          </DialogHeader>
          <img
            src={sizeChart}
            alt="Detailed Nongorr kurti measurement guide showing bust, waist, hip, shoulder, sleeve and length lines"
            loading="lazy"
            decoding="async"
            className="aspect-[4/5] w-full rounded-xl border border-border object-contain"
          />
          <ol className="mt-2 space-y-3">
            {measurements.map(([title, text], i) => (
              <li key={title} className="flex items-start gap-3 text-sm">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <span>
                  <strong className="text-foreground">{title}.</strong>{" "}
                  <span className="text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ----------------------------- FIXED SECTION ----------------------------- */

function FixedSection({
  activeCat,
  setActiveCat,
  categories,
}: {
  activeCat: string;
  setActiveCat: (c: string) => void;
  categories: CategoryEntry[];
}) {
  const current = categories.find((c) => c.id === activeCat) ?? categories[0];

  return (
    <div className="animate-fade-in space-y-8">
      <div className="text-center">
        <span className="eyebrow">Fixed Size Chart</span>
        <h2 className="mt-2 font-display text-3xl text-foreground">Fixed Size Measurements</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
          All measurements are shown in {current?.unit === "cm" ? "centimetres" : "inches"}.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
        <p className="text-sm leading-relaxed text-foreground">
          Fixed size chart is based on standard garment measurements. Please compare with a
          well-fitting dress you already own for the best result.
        </p>
      </div>

      {/* Category chips */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300",
                activeCat === c.id
                  ? "border-gold bg-primary text-primary-foreground shadow-soft ring-2 ring-gold/40"
                  : "border-border bg-card text-muted-foreground hover:border-gold/50 hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {current?.chart ? (
        <>
          <ChartTable chart={current.chart} title={current.label} />
          {current.note && (
            <p className="text-center text-xs text-muted-foreground">{current.note}</p>
          )}
        </>
      ) : (
        <SareeSection />
      )}

      <CosmeticsNote />
    </div>
  );
}

function ChartTable({ chart, title }: { chart: Chart; title: string }) {
  return (
    <PremiumCard className="overflow-hidden p-0">
      <div className="border-b border-border bg-secondary/50 px-5 py-4">
        <h3 className="font-display text-xl text-foreground">{title} Size Chart</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="bg-card text-left">
              {chart.cols.map((col) => (
                <th
                  key={col}
                  className="whitespace-nowrap px-4 py-3 font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => {
              const popular = row[row.length - 1] === "popular";
              const cells = popular ? row.slice(0, -1) : row;
              return (
                <tr
                  key={row[0]}
                  className="border-t border-border transition-colors hover:bg-primary/5"
                >
                  {cells.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "whitespace-nowrap px-4 py-3",
                        ci === 0 ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        {cell}
                        {ci === 0 && popular && (
                          <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-gold-foreground">
                            Most Selected
                          </span>
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PremiumCard>
  );
}

function SareeSection() {
  return (
    <PremiumCard accent>
      <h3 className="font-display text-2xl text-foreground">Saree Size Guide</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Sarees are usually one-size products. Blouse size, petticoat size, and fall/pico
        requirements may vary depending on the product. If blouse customization is available, please
        follow the custom measurement guide.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          ["Saree length", "Usually 5.5 yards"],
          ["Blouse piece", "Product dependent"],
          ["Petticoat", "Separate if available"],
          ["Custom blouse", "Available only if mentioned on product page"],
        ].map(([k, v]) => (
          <li
            key={k}
            className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-4 text-sm"
          >
            <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <span>
              <strong className="text-foreground">{k}:</strong>{" "}
              <span className="text-muted-foreground">{v}</span>
            </span>
          </li>
        ))}
      </ul>
    </PremiumCard>
  );
}

function CosmeticsNote() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-gold/50 bg-gold/5 p-5">
      <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
      <div>
        <h3 className="font-display text-xl text-foreground">Cosmetics Size Note</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Cosmetic products do not require body size selection. Please check shade, quantity, expiry
          information, and product details before ordering.
        </p>
      </div>
    </div>
  );
}

/* ----------------------- SIZE STARTING-POINT HELPER ---------------------- */

type FitPref = "fitted" | "regular" | "relaxed";

function SizeStartingPointHelper({ categories }: { categories: CategoryEntry[] }) {
  const [catId, setCatId] = useState<string>(categories[0]?.id ?? "kurti");
  const [basis, setBasis] = useState<"body" | "garment">("garment");
  const [value, setValue] = useState("");
  const [fit, setFit] = useState<FitPref>("regular");

  const cat = categories.find((c) => c.id === catId) ?? categories[0];
  const measure = Number(value);
  const hasValue = value.trim() !== "" && Number.isFinite(measure) && measure > 0;

  let result: { size: string; note: string; reviewNext?: string } | null = null;
  if (hasValue && cat.chart && cat.measureLabel) {
    const colIndex = cat.chart.cols.findIndex(
      (c) => c.toLowerCase() === cat.measureLabel.toLowerCase(),
    );
    if (colIndex >= 0) {
      let best: { size: string; diff: number; idx: number } | null = null;
      cat.chart.rows.forEach((row, idx) => {
        const chartVal = Number(row[colIndex]);
        if (!Number.isFinite(chartVal)) return;
        const diff = Math.abs(chartVal - measure);
        if (!best || diff < best.diff) best = { size: row[0], diff, idx };
      });
      if (best !== null) {
        const b = best as { size: string; diff: number; idx: number };
        const nextRow = cat.chart.rows[b.idx + 1];
        result = {
          size: b.size,
          note:
            basis === "garment"
              ? "Closest starting size based on your well-fitting garment measurement."
              : "Approximate starting point only — garment-chart values are not an exact body-to-size conversion.",
          reviewNext: fit === "relaxed" && nextRow ? nextRow[0] : undefined,
        };
      }
    }
  }

  return (
    <PremiumCard accent className="mt-12">
      <div className="flex items-center gap-2">
        <Ruler className="h-5 w-5 text-gold" />
        <h3 className="font-display text-2xl text-foreground">Size starting-point helper</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        This is a general guide, not a fit guarantee.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* Category */}
        <label className="text-sm">
          <span className="font-medium text-foreground">Category</span>
          <select
            value={catId}
            onChange={(e) => setCatId(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {/* Measurement basis */}
        <label className="text-sm">
          <span className="font-medium text-foreground">Measurement basis</span>
          <select
            value={basis}
            onChange={(e) => setBasis(e.target.value as "body" | "garment")}
            className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="body">Body measurement</option>
            <option value="garment">Well-fitting garment measurement</option>
          </select>
        </label>

        {/* Value */}
        <label className="text-sm">
          <span className="font-medium text-foreground">
            {cat.measureLabel || "Measurement"} ({cat.unit === "cm" ? "cm" : "inches"})
          </span>
          <input
            type="number"
            min={1}
            step={0.5}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 36"
            className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          />
        </label>

        {/* Fit preference */}
        <label className="text-sm">
          <span className="font-medium text-foreground">Fit preference</span>
          <select
            value={fit}
            onChange={(e) => setFit(e.target.value as FitPref)}
            className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="fitted">Fitted</option>
            <option value="regular">Regular</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>
      </div>

      {/* Result */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-4 text-sm">
        {!cat.chart ? (
          <p className="text-foreground">
            Sarees do not use a fixed size chart. For a customizable blouse, use Custom Size or{" "}
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              contact support
            </a>
            .
          </p>
        ) : !cat.measureLabel ? (
          <p className="text-muted-foreground">
            This chart doesn't use the automatic helper — compare the fixed size chart with a
            well-fitting garment you already own.
          </p>
        ) : !hasValue ? (
          <p className="text-muted-foreground">
            Enter your {cat.measureLabel.toLowerCase()} measurement in{" "}
            {cat.unit === "cm" ? "centimetres" : "inches"} to see a suggested starting size.
          </p>
        ) : result ? (
          <div className="space-y-1.5">
            <p className="text-foreground">
              Suggested starting size: <strong className="text-base">{result.size}</strong>
            </p>
            <p className="text-muted-foreground">{result.note}</p>
            {result.reviewNext && (
              <p className="text-muted-foreground">
                For a relaxed fit, you may also want to review size{" "}
                <strong className="text-foreground">{result.reviewNext}</strong>.
              </p>
            )}
            {basis === "body" && (
              <p className="text-muted-foreground">
                If you are unsure, consider Custom Size or{" "}
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  contact support
                </a>{" "}
                before ordering.
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            We could not match a size automatically. Please{" "}
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              contact support
            </a>{" "}
            for help.
          </p>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        This helper does not select or add any product. It is a starting point only.
      </p>
    </PremiumCard>
  );
}

/* -------------------------- SHARED LOWER SECTIONS ------------------------ */

function FitRecommendation() {
  const points = [
    "If you prefer a regular fit, choose your usual size.",
    "If you prefer a loose fit, choose one size larger.",
    "If your bust and hip fall into different sizes, choose the larger size.",
    "For handmade outfits, slight 0.5–1 inch variation may happen.",
    "For the best fit, compare the chart with a dress that fits you well.",
    "If unsure, contact support before ordering.",
  ];
  return (
    <PremiumCard accent className="mt-12">
      <div className="flex items-center gap-2">
        <HeartHandshake className="h-5 w-5 text-gold" />
        <h3 className="font-display text-2xl text-foreground">How to choose your size</h3>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {p}
          </li>
        ))}
      </ul>
    </PremiumCard>
  );
}

const faqs = [
  [
    "Should I give body measurement or dress measurement?",
    "For custom size, please give body measurement. For fixed size, compare our chart with a well-fitting dress.",
  ],
  [
    "Can I order custom size?",
    "Custom size is available only for selected products where the option is shown.",
  ],
  [
    "What if I am between two sizes?",
    "Choose the larger size for comfort or contact support for help.",
  ],
];

function FaqSection() {
  return (
    <div className="mt-12">
      <h3 className="text-center font-display text-2xl text-foreground">Size Guide FAQ</h3>
      <div className="ornament-divider mx-auto mt-3 mb-6 w-32" />
      <Accordion type="single" collapsible className="mx-auto max-w-2xl space-y-2">
        {faqs.map(([q, a]) => (
          <AccordionItem
            key={q}
            value={q}
            className="overflow-hidden rounded-2xl border border-border bg-card px-4 shadow-soft data-[state=open]:border-gold/50"
          >
            <AccordionTrigger className="py-4 text-left font-medium text-foreground hover:no-underline">
              {q}
            </AccordionTrigger>
            <AccordionContent className="pb-4 text-sm text-muted-foreground">{a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="mt-10 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">Still not sure about your size?</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 h-4 w-4" /> Chat with our boutique team
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/contact">Contact Support</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
