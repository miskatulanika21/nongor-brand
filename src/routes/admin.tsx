import {
  createFileRoute,
  Outlet,
  Link,
  useRouterState,
  useNavigate,
  useRouteContext,
  redirect,
} from "@tanstack/react-router";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { loadAdminArea, logout as serverLogout } from "@/lib/auth.api";
import { setLoggedInHint } from "@/lib/auth-state";
import type { AdminIconKey, AdminNavGroup } from "@/lib/admin-routes";
import type { StaffRole } from "@/lib/auth-types";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Boxes,
  ShoppingCart,
  Wallet,
  Truck,
  Users,
  Ticket,
  Star,
  Image,
  Images,
  Ruler,
  FileText,
  BarChart3,
  Settings,
  Shield,
  ScrollText,
  Menu,
  Bell,
  ExternalLink,
  LogOut,
} from "lucide-react";

/** Map stable icon keys (from the isomorphic nav map) to lucide components. */
const ICONS: Record<AdminIconKey, React.ElementType> = {
  dashboard: LayoutDashboard,
  products: Package,
  categories: FolderTree,
  inventory: Boxes,
  sizes: Ruler,
  orders: ShoppingCart,
  payments: Wallet,
  courier: Truck,
  customers: Users,
  coupons: Ticket,
  reviews: Star,
  banners: Image,
  media: Images,
  policies: FileText,
  reports: BarChart3,
  settings: Settings,
  staff: Shield,
  audit: ScrollText,
};

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};

interface AdminContext {
  staff: { userId: string; email: string | null; name: string | null; role: StaffRole };
  nav: AdminNavGroup[];
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Nongorr Studio · Admin" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  beforeLoad: async ({ location }): Promise<AdminContext> => {
    // /admin/login is a redirect-only route handled before any auth check.
    if (location.pathname === "/admin/login") {
      throw redirect({ to: "/login", search: { next: "/admin" } });
    }

    const result = await loadAdminArea({
      data: { pathname: location.pathname, next: location.pathname },
    });

    if (!result.allow) {
      throw redirect({ href: result.redirect });
    }

    return { staff: result.staff, nav: result.nav };
  },
  component: AdminLayout,
});

function NavList({
  nav,
  onNavigate,
  pathname,
  onLogout,
}: {
  nav: AdminNavGroup[];
  onNavigate?: () => void;
  pathname: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-5 p-3">
        {nav.map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {g.group}
            </p>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const Icon = ICONS[it.icon];
                const active =
                  it.to === "/admin" ? pathname === "/admin" : pathname.startsWith(it.to);
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {it.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button
          onClick={() => {
            onNavigate?.();
            onLogout();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </div>
  );
}

function AdminLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { staff, nav } = useRouteContext({ from: "/admin" }) as AdminContext;

  const handleLogout = async () => {
    await serverLogout();
    setLoggedInHint(false);
    navigate({ to: "/login", search: { next: undefined } });
  };

  const displayName = staff.name || staff.email || "Account";
  const initial = (displayName[0] ?? "N").toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <Logo variant="light" />
          <span className="ml-auto rounded bg-sidebar-primary/20 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-sidebar-primary">
            Studio
          </span>
        </div>
        <ScrollArea className="flex-1">
          <NavList nav={nav} pathname={pathname} onLogout={handleLogout} />
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-6">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
              <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-5">
                <SheetTitle className="sr-only">Admin menu</SheetTitle>
                <Logo variant="light" />
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-4rem)]">
                <NavList
                  nav={nav}
                  pathname={pathname}
                  onNavigate={() => setOpen(false)}
                  onLogout={handleLogout}
                />
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <div className="hidden sm:block">
            <p className="font-display text-lg leading-none text-foreground">Nongorr Studio</p>
            <p className="text-xs text-muted-foreground">Business control center</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                <ExternalLink className="h-4 w-4" /> View store
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="hidden text-right sm:block">
                <p className="max-w-[12rem] truncate text-sm font-medium leading-tight text-foreground">
                  {displayName}
                </p>
                <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                  {ROLE_LABEL[staff.role]}
                </p>
              </div>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-gold text-sm font-semibold text-gold-foreground">
                {initial}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
