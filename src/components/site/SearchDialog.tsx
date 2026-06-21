import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PRODUCTS, PRODUCT_TYPE_LABEL } from "@/lib/products";
import { PRODUCT_CATEGORIES } from "@/lib/categories";
import { formatBDT, discountPct } from "@/lib/brand";
import { cn } from "@/lib/utils";

// Categories come from the shared source — no independent array here.
const POPULAR = PRODUCT_CATEGORIES.map((c) => ({ label: c.label, category: c.category }));

const LISTBOX_ID = "search-results-listbox";
const optionId = (i: number) => `search-option-${i}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: Props) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1); // -1 = no product highlighted
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActive(-1);
    }
  }, [open]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return PRODUCTS.filter((p) => {
      const hay = [p.name, p.category, PRODUCT_TYPE_LABEL[p.type], p.fabric ?? "", p.occasion ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    }).slice(0, 8);
  }, [q]);

  // Highlight resets whenever the query changes.
  useEffect(() => {
    setActive(-1);
  }, [q]);

  function openProduct(slug: string) {
    navigate({ to: "/product/$slug", params: { slug } });
    onOpenChange(false);
  }

  function openShop() {
    navigate({ to: "/shop", search: { category: "", q: q.trim() } as never });
    onOpenChange(false);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // If the user has actively highlighted a product, open it; otherwise open
    // the full Shop search results. We never auto-open the first product.
    if (active >= 0 && results[active]) {
      openProduct(results[active].slug);
    } else if (q.trim()) {
      openShop();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    }
  };

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`#${optionId(active)}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        onEscapeKeyDown={() => setActive(-1)}
      >
        <DialogTitle className="sr-only">Search products</DialogTitle>
        <form
          onSubmit={handleSubmit}
          role="search"
          className="flex items-center gap-3 border-b border-border px-4 py-3.5 pr-12"
        >
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="site-search-input" className="sr-only">
            Search products
          </label>
          <input
            id="site-search-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search kurti, saree, cosmetics…"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </form>

        <div className="max-h-[60vh] overflow-y-auto" ref={listRef}>
          {!q.trim() && (
            <div className="p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Popular categories
              </p>
              <div className="flex flex-wrap gap-2">
                {POPULAR.map((c) => (
                  <Link
                    key={c.category}
                    to="/shop"
                    search={{ category: c.category } as never}
                    onClick={() => onOpenChange(false)}
                    className="rounded-full border border-border bg-secondary px-3.5 py-1.5 text-sm text-foreground transition-colors hover:border-gold/50 hover:text-primary"
                  >
                    {c.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {q.trim() && results.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No matches for <span className="font-medium text-foreground">"{q}"</span>
              </p>
            </div>
          )}

          <div id={LISTBOX_ID} role="listbox" aria-label="Search results">
            {results.map((p, i) => {
              const pct = discountPct(p.price, p.salePrice);
              const isActive = i === active;
              return (
                <Link
                  key={p.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isActive}
                  to="/product/$slug"
                  params={{ slug: p.slug }}
                  onClick={() => onOpenChange(false)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 transition-colors",
                    isActive ? "bg-secondary" : "hover:bg-secondary",
                  )}
                >
                  <img
                    src={p.image}
                    alt={p.name}
                    loading="lazy"
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                    <span className="text-xs text-muted-foreground">
                      {PRODUCT_TYPE_LABEL[p.type]}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {formatBDT(p.salePrice ?? p.price)}
                    </p>
                    {pct && <p className="text-[0.7rem] text-success">-{pct}%</p>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <Link
          to="/shop"
          search={(q.trim() ? { category: "", q: q.trim() } : { category: "" }) as never}
          onClick={() => onOpenChange(false)}
          className="block border-t border-border px-4 py-3 text-center text-sm font-medium text-primary transition-colors hover:bg-secondary"
        >
          View all in Shop
        </Link>
      </DialogContent>
    </Dialog>
  );
}
