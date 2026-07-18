import { Link, useSearch, useRouterState } from "@tanstack/react-router";
import {
  Menu,
  Heart,
  ShoppingBag,
  User,
  Search,
  X,
  Package,
  Truck,
  Ruler,
  MessageCircle,
  LayoutDashboard,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { SearchDialog } from "@/components/site/SearchDialog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BRAND, formatBDT, whatsappConfigured } from "@/lib/brand";
import { FREE_DELIVERY_THRESHOLD } from "@/lib/checkout-ui";
import { isSafeLinkUrl, type AnnouncementState } from "@/lib/settings.schema";
import { PRODUCT_CATEGORIES, categoryPath } from "@/lib/categories";
import { useIsLoggedIn } from "@/lib/auth-state";

export interface SessionSummary {
  isAuthenticated: boolean;
  designation: string;
  hasAdminAccess: boolean;
}

type TopNavItem = { label: string; to: string; filter?: string };

// Top-level links (Shop is a dropdown handled separately). No category arrays
// are recreated here — categories come from the shared source below.
const TOP_NAV: TopNavItem[] = [
  { label: "Home", to: "/" },
  { label: "New Arrivals", to: "/shop", filter: "new-arrivals" },
  { label: "Custom Fit", to: "/custom-size-policy" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

const ANNOUNCE_KEY = "nongorr.announce.dismissed";

export function SiteHeader({
  sessionSummary,
  announcement,
}: {
  sessionSummary?: SessionSummary;
  announcement?: AnnouncementState;
}) {
  const { cartCount, wishlist } = useStore();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(true);
  const annState: AnnouncementState = announcement ?? { mode: "fallback" };
  const headerRef = useRef<HTMLElement | null>(null);

  // Use session summary if provided, otherwise fall back to the client-side hook
  const isLoggedInHook = useIsLoggedIn();
  const isLoggedIn = sessionSummary?.isAuthenticated ?? isLoggedInHook;
  const hasAdminAccess = sessionSummary?.hasAdminAccess ?? false;
  const accountTo = isLoggedIn ? "/account" : "/login";

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const shopSearch = useSearch({ strict: false }) as { category?: string; filter?: string };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAnnounceOpen(localStorage.getItem(ANNOUNCE_KEY) !== "1");
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Measure the actual rendered header height and publish it as a shared CSS
  // custom property so sticky elements never slide under the header — regardless
  // of the announcement bar, text wrapping, zoom or font loading.
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof window === "undefined") return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) {
        document.documentElement.style.setProperty("--site-header-offset", `${Math.round(h)}px`);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [announceOpen]);

  function dismissAnnounce() {
    setAnnounceOpen(false);
    try {
      localStorage.setItem(ANNOUNCE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const onShop = pathname === "/shop";
  const onProduct = pathname.startsWith("/product");

  function isTopActive(item: TopNavItem) {
    if (item.filter) return onShop && shopSearch.filter === item.filter;
    if (item.to === "/") return pathname === "/";
    return pathname === item.to;
  }
  // Shop trigger is active on /shop (without a discovery filter) and on product pages.
  const shopActive = (onShop && shopSearch.filter !== "new-arrivals") || onProduct;

  // Subtle active state for the Account icon when the user is in any
  // account-related route (login, register, account hub, orders). On /login
  // this is the ONLY active hint in the header — no top-nav link should
  // appear active, which is already true because none of TOP_NAV matches.
  const accountActive =
    pathname === "/login" || pathname.startsWith("/account") || pathname.startsWith("/orders");

  return (
    <header
      ref={headerRef}
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-[box-shadow,background-color,border-color] duration-300",
        scrolled
          ? "border-border bg-background/90 shadow-soft backdrop-blur-xl"
          : "border-border/50 bg-background/70 backdrop-blur-md",
      )}
    >
      {announceOpen && annState.mode !== "hidden" && (
        <div className="relative bg-gradient-hero text-primary-foreground">
          <p className="animate-fade-in px-9 py-1.5 text-center text-[0.68rem] font-medium leading-tight tracking-wide sm:text-xs">
            {annState.mode === "custom" ? (
              annState.link && isSafeLinkUrl(annState.link) ? (
                <a href={annState.link} className="underline-offset-2 hover:underline">
                  {annState.text}
                </a>
              ) : (
                annState.text
              )
            ) : (
              <>
                ✦ Free delivery over {formatBDT(FREE_DELIVERY_THRESHOLD)} · Custom-size kurti
                available ✦
              </>
            )}
          </p>
          <button
            type="button"
            onClick={dismissAnnounce}
            aria-label="Dismiss announcement"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-primary-foreground/80 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        {/* Mobile / tablet menu — drawer is kept through xl to avoid nav crowding */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11 xl:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-[88vw] max-w-sm flex-col gap-0 p-0">
            <SheetHeader className="border-b border-gold/20 bg-gradient-hero px-5 py-4 text-left">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <Logo variant="light" />
            </SheetHeader>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <div className="flex flex-col gap-0.5">
                <DrawerLink to="/" onNavigate={() => setOpen(false)} active={pathname === "/"}>
                  Home
                </DrawerLink>
                <DrawerLink to="/shop" onNavigate={() => setOpen(false)} active={shopActive}>
                  Shop All
                </DrawerLink>
                {PRODUCT_CATEGORIES.map((c) => (
                  <DrawerLink
                    key={c.category}
                    to={categoryPath(c.category)}
                    onNavigate={() => setOpen(false)}
                    active={pathname === categoryPath(c.category)}
                    indented
                  >
                    {c.label}
                  </DrawerLink>
                ))}
                <DrawerLink
                  to="/shop"
                  search={{ filter: "new-arrivals" }}
                  onNavigate={() => setOpen(false)}
                  active={onShop && shopSearch.filter === "new-arrivals"}
                >
                  New Arrivals
                </DrawerLink>
                <DrawerLink
                  to="/custom-size-policy"
                  onNavigate={() => setOpen(false)}
                  active={pathname === "/custom-size-policy"}
                >
                  Custom Fit
                </DrawerLink>
                <DrawerLink
                  to="/about"
                  onNavigate={() => setOpen(false)}
                  active={pathname === "/about"}
                >
                  About
                </DrawerLink>
                <DrawerLink
                  to="/contact"
                  onNavigate={() => setOpen(false)}
                  active={pathname === "/contact"}
                >
                  Contact
                </DrawerLink>
              </div>

              <div className="my-3 h-px bg-border" />

              <button
                onClick={() => {
                  setOpen(false);
                  setSearchOpen(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary"
              >
                <Search className="h-4 w-4" /> Search products
              </button>
              <DrawerUtil to={accountTo} icon={User} onNavigate={() => setOpen(false)}>
                {isLoggedIn ? "My Account" : "Account / Login"}
              </DrawerUtil>
              {hasAdminAccess && (
                <DrawerUtil to="/admin" icon={LayoutDashboard} onNavigate={() => setOpen(false)}>
                  Admin Dashboard
                </DrawerUtil>
              )}
              <DrawerUtil to="/orders" icon={Package} onNavigate={() => setOpen(false)}>
                My Orders
              </DrawerUtil>
              <DrawerUtil to="/track" icon={Truck} onNavigate={() => setOpen(false)}>
                Track Order
              </DrawerUtil>
              <DrawerUtil to="/account/measurements" icon={Ruler} onNavigate={() => setOpen(false)}>
                Saved Measurements
              </DrawerUtil>
              <DrawerUtil to="/size-guide" icon={Ruler} onNavigate={() => setOpen(false)}>
                Size Guide
              </DrawerUtil>
              <DrawerUtil to="/contact" icon={MessageCircle} onNavigate={() => setOpen(false)}>
                Contact
              </DrawerUtil>
              {whatsappConfigured && (
                <a
                  href={`https://wa.me/${BRAND.whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-success transition-colors hover:bg-success/10"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp Support
                </a>
              )}
            </nav>

            <div className="border-t border-border px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="grid grid-cols-2 gap-2">
                <Link
                  to="/wishlist"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Heart className="h-4 w-4" /> Wishlist ({wishlist.length})
                </Link>
                <Link
                  to="/cart"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <ShoppingBag className="h-4 w-4" /> Cart ({cartCount})
                </Link>
              </div>
              <Button asChild variant="outline" className="mt-2 w-full">
                <Link to={accountTo} onClick={() => setOpen(false)}>
                  <User className="h-4 w-4" /> {isLoggedIn ? "My Account" : "Account / Login"}
                </Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <Link to="/" className="mr-auto xl:mr-0" aria-label="Nongorr home">
          {/* Compact mark on the smallest screens, full wordmark from sm up */}
          <Logo showName={false} className="sm:hidden" />
          <Logo className="hidden sm:inline-flex" />
        </Link>

        {/* Desktop nav (xl+) with accessible Shop dropdown */}
        <NavigationMenu className="mx-auto hidden xl:flex">
          <NavigationMenuList className="gap-1">
            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={navigationMenuTriggerStyle()}
                data-active={pathname === "/" || undefined}
              >
                <Link to="/">Home</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger data-active={shopActive || undefined}>
                Shop
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid w-[22rem] gap-1 p-3">
                  <li>
                    <ShopMenuLink
                      to="/shop"
                      title="Shop All"
                      desc="Browse the full collection"
                      active={shopActive}
                    />
                  </li>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <li key={c.category}>
                      <ShopMenuLink
                        to={categoryPath(c.category)}
                        title={c.label}
                        active={pathname === categoryPath(c.category)}
                      />
                    </li>
                  ))}
                  <li>
                    <ShopMenuLink
                      to="/shop"
                      search={{ filter: "best-sellers" }}
                      title="Best Sellers"
                      desc="Customer favourites"
                      active={onShop && shopSearch.filter === "best-sellers"}
                    />
                  </li>
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            {TOP_NAV.filter((i) => i.to !== "/").map((item) => (
              <NavigationMenuItem key={item.label}>
                <NavigationMenuLink
                  asChild
                  className={navigationMenuTriggerStyle()}
                  data-active={isTopActive(item) || undefined}
                >
                  <Link
                    to={item.to}
                    search={(item.filter ? { filter: item.filter } : undefined) as never}
                  >
                    {item.label}
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        {/* Actions */}
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-0.5">
            <HeaderAction label="Search products" onClick={() => setSearchOpen(true)}>
              <Search className="h-5 w-5" />
            </HeaderAction>
            <HeaderAction
              label={isLoggedIn ? "My account" : "Account / login"}
              to={accountTo}
              active={accountActive}
              className="hidden sm:inline-flex"
            >
              <User className="h-5 w-5" />
            </HeaderAction>
            {hasAdminAccess && (
              <HeaderAction
                label="Admin Dashboard"
                to="/admin"
                active={pathname.startsWith("/admin")}
                className="hidden sm:inline-flex"
              >
                <LayoutDashboard className="h-5 w-5" />
              </HeaderAction>
            )}
            <HeaderAction
              label="Wishlist"
              to="/wishlist"
              badge={wishlist.length}
              badgeNoun="saved item"
              active={pathname === "/wishlist"}
              className="hidden sm:inline-flex"
            >
              <Heart className="h-5 w-5" />
            </HeaderAction>
            <HeaderAction
              label="Cart"
              to="/cart"
              badge={cartCount}
              badgeNoun="item"
              active={pathname === "/cart"}
            >
              <ShoppingBag className="h-5 w-5" />
            </HeaderAction>
          </div>
        </TooltipProvider>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

function DrawerLink({
  to,
  search,
  active,
  indented,
  onNavigate,
  children,
}: {
  to: string;
  search?: Record<string, string>;
  active?: boolean;
  indented?: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      search={search as never}
      onClick={onNavigate}
      className={cn(
        "rounded-lg px-3 py-2.5 font-display text-lg transition-colors",
        indented && "pl-6 text-base",
        active ? "bg-secondary text-primary" : "text-foreground hover:bg-secondary",
      )}
    >
      {children}
    </Link>
  );
}

function DrawerUtil({
  to,
  icon: Icon,
  onNavigate,
  children,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
    >
      <Icon className="h-4 w-4" /> {children}
    </Link>
  );
}

function ShopMenuLink({
  to,
  search,
  title,
  desc,
  active,
}: {
  to: string;
  search?: Record<string, string>;
  title: string;
  desc?: string;
  active?: boolean;
}) {
  return (
    <NavigationMenuLink asChild>
      <Link
        to={to}
        search={search as never}
        className={cn(
          "block select-none rounded-lg px-3 py-2.5 leading-none no-underline outline-none transition-colors hover:bg-secondary focus:bg-secondary",
          active && "bg-secondary",
        )}
      >
        <span className={cn("text-sm font-medium", active ? "text-primary" : "text-foreground")}>
          {title}
        </span>
        {desc && <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>}
      </Link>
    </NavigationMenuLink>
  );
}

function HeaderAction({
  label,
  to,
  onClick,
  badge,
  badgeNoun,
  active,
  className,
  children,
}: {
  label: string;
  to?: string;
  onClick?: () => void;
  badge?: number;
  badgeNoun?: string;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const count = badge ?? 0;
  // Visible badge caps at 99+, but the accessible name keeps the real count.
  const accessibleLabel =
    badge !== undefined && count > 0
      ? `${label}, ${count} ${badgeNoun ?? "item"}${count === 1 ? "" : "s"}`
      : label;
  const inner = (
    <span className="relative inline-flex">
      {children}
      {badge !== undefined && count > 0 && <Badge>{count}</Badge>}
    </span>
  );
  // Subtle active state (small gold dot below the icon). Used by the Account
  // icon on /login so the header has at most one active hint, not zero.
  const btnClass = cn(
    "relative min-h-11 min-w-11 transition-transform active:scale-95",
    active &&
      "text-primary after:absolute after:bottom-1.5 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-gold",
    className,
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {to ? (
          <Button
            variant="ghost"
            size="icon"
            asChild
            aria-label={accessibleLabel}
            className={btnClass}
          >
            <Link to={to}>{inner}</Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={accessibleLabel}
            onClick={onClick}
            className={btnClass}
          >
            {inner}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent className="hidden xl:block">{label}</TooltipContent>
    </Tooltip>
  );
}

function Badge({ children }: { children: number }) {
  const label = children > 99 ? "99+" : children;
  return (
    <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.6rem] font-semibold leading-none text-primary-foreground ring-2 ring-background">
      {label}
    </span>
  );
}
