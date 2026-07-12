import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { listProductCards, getCatalogFacets } from "@/lib/catalog.api";
import { facetValues } from "@/lib/catalog-facets";
import {
  CATEGORY_FILTERS,
  rollupCategoryCounts,
  matchesCategory,
  matchesFilter,
  categoryLabel,
  filterLabel,
} from "@/lib/categories";
import { ProductGrid } from "@/components/ProductGrid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  SlidersHorizontal,
  X,
  Search,
  LayoutGrid,
  Rows3,
  PackageSearch,
  MessageCircle,
} from "lucide-react";
import { formatBDT, BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import type { ProductCardView } from "@/components/ProductCard";

const PRICE_MAX = 8000;
type ShopSearch = { category?: string; q?: string; filter?: string };

export const Route = createFileRoute("/_site/shop")({
  validateSearch: (s: Record<string, unknown>): ShopSearch => {
    const out: ShopSearch = {};
    const c = typeof s.category === "string" ? s.category : "";
    const q = typeof s.q === "string" ? s.q : "";
    const f = typeof s.filter === "string" ? s.filter : "";
    if (c) out.category = c;
    if (q) out.q = q;
    if (f) out.filter = f;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Shop · Nongorr" },
      {
        name: "description",
        content:
          "Browse Nongorr's kurti, saree, three piece, girls dress and beauty collection with smart filters.",
      },
      { property: "og:title", content: "Shop · Nongorr" },
      {
        property: "og:description",
        content:
          "Browse Nongorr's kurti, saree, three piece, girls dress and beauty collection with smart filters.",
      },
      { property: "og:url", content: "/shop" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/shop" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Shop · Nongorr",
          url: "/shop",
          description:
            "Browse Nongorr's kurti, saree, three piece, girls dress and beauty collection.",
        }),
      },
    ],
  }),
  loader: async () => {
    const [products, facets] = await Promise.all([listProductCards(), getCatalogFacets()]);
    return { products, facets };
  },
  component: Shop,
});

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Shop() {
  const { products, facets } = Route.useLoaderData();
  const categoryCounts = useMemo(() => rollupCategoryCounts(facets), [facets]);
  const colorOptions = useMemo(() => facetValues(facets.colors), [facets]);
  const fabricOptions = useMemo(() => facetValues(facets.fabrics), [facets]);
  const occasionOptions = useMemo(() => facetValues(facets.occasions), [facets]);
  const search = Route.useSearch();
  const category = search.category ?? "";
  const q = search.q ?? "";
  const filter = search.filter ?? "";
  const navigate = useNavigate();
  const term = (q || "").trim().toLowerCase();
  const [searchInput, setSearchInput] = useState(q ?? "");
  const [cats, setCats] = useState<string[]>(category ? [category] : []);
  const [colors, setColors] = useState<string[]>([]);
  const [fabrics, setFabrics] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [price, setPrice] = useState<number[]>([PRICE_MAX]);
  const [inStock, setInStock] = useState(false);
  const [onSale, setOnSale] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [customOnly, setCustomOnly] = useState(false);
  const [sort, setSort] = useState("featured");
  const [mobileFilters, setMobileFilters] = useState(false);
  const [view, setView] = useState<ProductCardView>("grid");

  // Sync local category selection with the URL search param.
  useEffect(() => {
    const next = category ? [category] : [];
    setCats((prev) =>
      prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
    );
  }, [category]);

  // URL -> local search, only when the URL value genuinely changes.
  useEffect(() => {
    const next = q ?? "";
    setSearchInput((current: string) => (current === next ? current : next));
  }, [q]);

  // local -> URL search, debounced, history-replaced, preserving other params.
  const navRef = useRef(navigate);
  navRef.current = navigate;
  useEffect(() => {
    const normalized = searchInput.trim();
    if (normalized === (q ?? "")) return;
    const t = setTimeout(() => {
      navRef.current({
        to: "/shop",
        replace: true,
        search: (previous: ShopSearch) => ({ ...previous, q: normalized }),
      });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, q]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (term && !`${p.name} ${p.category}`.toLowerCase().includes(term)) return false;
      if (cats.length && !cats.some((c) => matchesCategory(p, c))) return false;
      if (filter && !matchesFilter(p, filter)) return false;
      if (colors.length && !colors.includes(p.color)) return false;
      if (fabrics.length && (!p.fabric || !fabrics.includes(p.fabric))) return false;
      if (occasions.length && (!p.occasion || !occasions.includes(p.occasion))) return false;
      if ((p.salePrice ?? p.price) > price[0]) return false;
      if (inStock && p.stock <= 0) return false;
      if (onSale && !p.salePrice) return false;
      if (newOnly && !p.isNew) return false;
      if (customOnly && !p.customSize) return false;
      return true;
    });
    if (sort === "low")
      list = [...list].sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price));
    if (sort === "high")
      list = [...list].sort((a, b) => (b.salePrice ?? b.price) - (a.salePrice ?? a.price));
    if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
    if (sort === "popular") list = [...list].sort((a, b) => b.reviewCount - a.reviewCount);
    if (sort === "newest")
      list = [...list].sort((a, b) => Number(b.isNew ?? false) - Number(a.isNew ?? false));
    return list;
  }, [
    term,
    cats,
    filter,
    colors,
    fabrics,
    occasions,
    price,
    inStock,
    onSale,
    newOnly,
    customOnly,
    sort,
    products,
  ]);

  const showCosmetic = cats.includes("cosmetics");
  const priceActive = price[0] < PRICE_MAX;
  const searchActive = (q ?? "").trim().length > 0;
  const activeCount =
    cats.length +
    colors.length +
    fabrics.length +
    occasions.length +
    (filter ? 1 : 0) +
    (priceActive ? 1 : 0) +
    (inStock ? 1 : 0) +
    (onSale ? 1 : 0) +
    (newOnly ? 1 : 0) +
    (customOnly ? 1 : 0) +
    (searchActive ? 1 : 0);

  // Honest cosmetic metadata, derived from the full customer-facing rollup.
  const cosmeticProducts = products.filter((p) => matchesCategory(p, "cosmetics"));
  const shades = [...new Set(cosmeticProducts.map((p) => p.shade).filter(Boolean))] as string[];
  const skinTypes = [
    ...new Set(cosmeticProducts.map((p) => p.skinType).filter(Boolean)),
  ] as string[];
  const volumes = [...new Set(cosmeticProducts.map((p) => p.volume).filter(Boolean))] as string[];

  // No-results recommendations: dedupe by id, best sellers first then rating, max 4.
  const recommendations = useMemo(() => {
    const seen = new Set<string>();
    return [...products]
      .sort(
        (a, b) =>
          Number(b.isBestSeller ?? false) - Number(a.isBestSeller ?? false) || b.rating - a.rating,
      )
      .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      .slice(0, 4);
  }, [products]);

  const whatsappUrl = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent("Hi Nongorr, I need help finding a product.")}`;

  function clearSearch() {
    setSearchInput("");
    if ((q ?? "").trim())
      navigate({ to: "/shop", replace: true, search: (prev: ShopSearch) => ({ ...prev, q: "" }) });
  }

  function clearFilter() {
    navigate({ to: "/shop", search: (prev: ShopSearch) => ({ ...prev, filter: "" }) });
  }

  function clearCategory(c: string) {
    setCats(toggle(cats, c));
    if (category === c)
      navigate({ to: "/shop", search: (prev: ShopSearch) => ({ ...prev, category: "" }) });
  }

  function clearAll() {
    setCats([]);
    setColors([]);
    setFabrics([]);
    setOccasions([]);
    setPrice([PRICE_MAX]);
    setInStock(false);
    setOnSale(false);
    setNewOnly(false);
    setCustomOnly(false);
    setSearchInput("");
    if (category || filter || (q ?? "").trim())
      navigate({ to: "/shop", replace: true, search: () => ({ category: "", filter: "", q: "" }) });
  }

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(searchActive
      ? [{ key: "q", label: `Search: “${(q ?? "").trim()}”`, remove: clearSearch }]
      : []),
    ...(filter
      ? [{ key: `filter-${filter}`, label: filterLabel(filter), remove: clearFilter }]
      : []),
    ...cats.map((c) => ({
      key: `cat-${c}`,
      label: categoryLabel(c),
      remove: () => clearCategory(c),
    })),
    ...colors.map((c) => ({
      key: `col-${c}`,
      label: c,
      remove: () => setColors(toggle(colors, c)),
    })),
    ...fabrics.map((f) => ({
      key: `fab-${f}`,
      label: f,
      remove: () => setFabrics(toggle(fabrics, f)),
    })),
    ...occasions.map((o) => ({
      key: `occ-${o}`,
      label: o,
      remove: () => setOccasions(toggle(occasions, o)),
    })),
    ...(priceActive
      ? [
          {
            key: "price",
            label: `Up to ${formatBDT(price[0])}`,
            remove: () => setPrice([PRICE_MAX]),
          },
        ]
      : []),
    ...(inStock ? [{ key: "instock", label: "In stock", remove: () => setInStock(false) }] : []),
    ...(onSale ? [{ key: "sale", label: "On discount", remove: () => setOnSale(false) }] : []),
    ...(newOnly ? [{ key: "new", label: "New arrival", remove: () => setNewOnly(false) }] : []),
    ...(customOnly
      ? [{ key: "custom", label: "Custom-size", remove: () => setCustomOnly(false) }]
      : []),
  ];

  const Filters = (
    <div className="space-y-1">
      <Accordion type="multiple" defaultValue={["cat", "price", "color", "more"]}>
        <AccordionItem value="cat">
          <AccordionTrigger className="text-sm font-medium">Category</AccordionTrigger>
          <AccordionContent className="space-y-2.5">
            {CATEGORY_FILTERS.map((c) => (
              <Row
                key={c.slug}
                id={`c-${c.slug}`}
                checked={cats.includes(c.slug)}
                onChange={() => setCats(toggle(cats, c.slug))}
                label={`${c.name}`}
                sub={categoryCounts[c.slug]}
              />
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="price">
          <AccordionTrigger className="text-sm font-medium">Price</AccordionTrigger>
          <AccordionContent className="px-1 pt-3">
            <Slider
              value={price}
              onValueChange={setPrice}
              min={500}
              max={PRICE_MAX}
              step={100}
              thumbLabel="Price"
            />
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">৳500</span>
              <span className="font-medium text-foreground">
                {priceActive ? `Up to ${formatBDT(price[0])}` : "Any price"}
              </span>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="color">
          <AccordionTrigger className="text-sm font-medium">Color</AccordionTrigger>
          <AccordionContent className="space-y-2.5">
            {colorOptions.map((c) => (
              <Row
                key={c}
                id={`col-${c}`}
                checked={colors.includes(c)}
                onChange={() => setColors(toggle(colors, c))}
                label={c}
              />
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="fabric">
          <AccordionTrigger className="text-sm font-medium">Fabric / Material</AccordionTrigger>
          <AccordionContent className="space-y-2.5">
            {fabricOptions.map((f) => (
              <Row
                key={f}
                id={`f-${f}`}
                checked={fabrics.includes(f)}
                onChange={() => setFabrics(toggle(fabrics, f))}
                label={f}
              />
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="occasion">
          <AccordionTrigger className="text-sm font-medium">Occasion</AccordionTrigger>
          <AccordionContent className="space-y-2.5">
            {occasionOptions.map((o) => (
              <Row
                key={o}
                id={`o-${o}`}
                checked={occasions.includes(o)}
                onChange={() => setOccasions(toggle(occasions, o))}
                label={o}
              />
            ))}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="more">
          <AccordionTrigger className="text-sm font-medium">Availability & Tags</AccordionTrigger>
          <AccordionContent className="space-y-2.5">
            <Row
              id="instock"
              checked={inStock}
              onChange={() => setInStock(!inStock)}
              label="In stock only"
            />
            <Row
              id="sale"
              checked={onSale}
              onChange={() => setOnSale(!onSale)}
              label="On discount"
            />
            <Row
              id="new"
              checked={newOnly}
              onChange={() => setNewOnly(!newOnly)}
              label="New arrival"
            />
            <Row
              id="custom"
              checked={customOnly}
              onChange={() => setCustomOnly(!customOnly)}
              label="Custom-size available"
            />
          </AccordionContent>
        </AccordionItem>

        {showCosmetic && (
          <AccordionItem value="beauty">
            <AccordionTrigger className="text-sm font-medium">Beauty Options</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-1">
              <p className="text-xs text-muted-foreground">
                Beauty details from our current cosmetics range.
              </p>
              <PillGroup label="Shades" items={shades} />
              <PillGroup label="Skin type" items={skinTypes} />
              <PillGroup label="Volume" items={volumes} />
              <DisabledFilterGroup label="Brand" />
              <DisabledFilterGroup label="Authenticity" />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
      <Separator className="my-3" />
      <Button variant="outline" className="w-full" onClick={clearAll}>
        Clear all filters
      </Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8 text-center">
        <span className="eyebrow">The Collection</span>
        <h1 className="font-display text-4xl text-foreground sm:text-5xl">Shop Nongorr</h1>
        <div className="ornament-divider mx-auto mt-3 w-40" />
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="site-sticky-with-gap site-sticky-max-height sticky overflow-y-auto pr-1">
            {Filters}
          </div>
        </aside>

        <div className="flex-1">
          {/* In-page search */}
          <div className="mb-4">
            <label htmlFor="shop-search" className="sr-only">
              Search products
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="shop-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search kurti, saree, serum…"
                className="h-11 pl-9 pr-10"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
              {products.length} products
            </p>
            <div className="flex items-center gap-2">
              <div className="hidden items-center rounded-md border border-border p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded transition-colors",
                    view === "grid"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-label="Compact list view"
                  aria-pressed={view === "list"}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded transition-colors",
                    view === "list"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Rows3 className="h-4 w-4" />
                </button>
              </div>
              <Sheet open={mobileFilters} onOpenChange={setMobileFilters}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="relative lg:hidden">
                    <SlidersHorizontal className="h-4 w-4" /> Filters
                    {activeCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
                        {activeCount}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  className="flex max-h-[85vh] flex-col rounded-t-2xl p-0"
                >
                  <SheetHeader className="border-b border-border px-5 py-4 text-left">
                    <SheetTitle>Filters{activeCount > 0 ? ` (${activeCount})` : ""}</SheetTitle>
                  </SheetHeader>
                  <div className="flex-1 overflow-y-auto px-5 py-4 pb-6">{Filters}</div>
                  <div className="flex gap-3 border-t border-border px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                    <Button variant="outline" className="flex-1" onClick={clearAll}>
                      Clear all
                    </Button>
                    <Button className="flex-1" onClick={() => setMobileFilters(false)}>
                      Show {filtered.length} products
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-40" aria-label="Sort products">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="featured">Featured</SelectItem>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="popular">Most Popular</SelectItem>
                  <SelectItem value="rating">Top Rated</SelectItem>
                  <SelectItem value="low">Price: Low to High</SelectItem>
                  <SelectItem value="high">Price: High to Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  onClick={chip.remove}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {chip.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                onClick={clearAll}
                className="px-2 py-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {filtered.length ? (
            <ProductGrid products={filtered} view={view} />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-secondary text-primary">
                <PackageSearch className="h-7 w-7" />
              </div>
              <h3 className="mt-4 font-display text-2xl text-foreground">
                No products match your filters
              </h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Try clearing your filters or search, or talk to our team for a personal
                recommendation.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Button onClick={clearAll}>Clear Filters</Button>
                <Button variant="outline" asChild>
                  <a href={whatsappUrl} target="_blank" rel="noreferrer" className="gap-2">
                    <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
                  </a>
                </Button>
              </div>

              <div className="mt-10 text-left">
                <h4 className="mb-4 text-center font-display text-lg text-foreground">
                  You may also like
                </h4>
                <ProductGrid products={recommendations} view="grid" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PillGroup({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function DisabledFilterGroup({ label }: { label: string }) {
  return (
    <div aria-disabled className="pointer-events-none select-none opacity-55">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <Badge
          variant="outline"
          className="border-border text-[0.6rem] font-normal text-muted-foreground"
        >
          Coming soon
        </Badge>
      </div>
      <div className="flex items-center gap-2.5">
        <Checkbox id={`disabled-${label}`} checked={false} disabled aria-disabled tabIndex={-1} />
        <Label htmlFor={`disabled-${label}`} className="text-sm font-normal text-muted-foreground">
          Filter not available yet
        </Label>
      </div>
    </div>
  );
}

function Row({
  id,
  checked,
  onChange,
  label,
  sub,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  sub?: number;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md px-1 py-0.5 transition-colors",
        checked && "bg-secondary/70",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
        <Label
          htmlFor={id}
          className={cn(
            "cursor-pointer text-sm font-normal text-foreground",
            checked && "font-medium text-primary",
          )}
        >
          {label}
        </Label>
      </div>
      {typeof sub === "number" && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}
