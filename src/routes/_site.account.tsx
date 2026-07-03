import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  redirect,
  useRouteContext,
} from "@tanstack/react-router";
import { AccountUIProvider, useAccountUI, initials } from "@/lib/account-ui";
import { getMyAccountFn } from "@/lib/account.api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { loadCustomerArea, logout as serverLogout } from "@/lib/auth.api";
import { bustSiteContext } from "@/lib/site-context-cache";
import { setLoggedInHint } from "@/lib/auth-state";
import { useNoticeToast } from "@/lib/auth-notices";
import {
  LayoutDashboard,
  Package,
  User,
  MapPin,
  Ruler,
  Heart,
  ShieldCheck,
  LogOut,
} from "lucide-react";

interface CustomerSession {
  userId: string;
  email: string | null;
  name: string | null;
}

export const Route = createFileRoute("/_site/account")({
  head: () => ({
    meta: [
      { title: "My Account · Nongorr" },
      {
        name: "description",
        content:
          "Manage your Nongorr profile, delivery addresses, saved measurement profiles and wishlist — synced securely to your account.",
      },
      { property: "og:title", content: "My Account · Nongorr" },
      {
        property: "og:description",
        content: "Your personal Nongorr boutique account space.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: "/account" }],
  }),
  beforeLoad: async ({ location }) => {
    // Customer-only guard. Active staff/admin/owner are redirected to /admin;
    // inactive staff are signed out; lookup failures fail closed. (Spec §11.)
    const result = await loadCustomerArea({ data: { next: location.pathname } });
    if (!result.allow) {
      throw redirect({ href: result.redirect });
    }
    return { session: result.user as CustomerSession };
  },
  // SSR the account snapshot so the header/pages render real data with no
  // skeleton flash. The provider seeds once per mount; a brief staleTime stops
  // child-tab navigations from refetching (and burning accountRead budget).
  loader: async () => {
    const res = await getMyAccountFn();
    return res.success
      ? { snapshot: res.account, loadError: false }
      : { snapshot: null, loadError: true };
  },
  staleTime: 30_000,
  component: AccountRoute,
});

const NAV = [
  { to: "/account", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/orders", label: "Orders", icon: Package, exact: false },
  { to: "/account/profile", label: "Profile", icon: User, exact: false },
  { to: "/account/addresses", label: "Addresses", icon: MapPin, exact: false },
  {
    to: "/account/measurements",
    label: "Measurements",
    icon: Ruler,
    exact: false,
  },
  { to: "/wishlist", label: "Wishlist", icon: Heart, exact: false },
  { to: "/account/security", label: "Security", icon: ShieldCheck, exact: false },
] as const;

function AccountRoute() {
  const { session } = useRouteContext({ from: "/_site/account" }) as { session: CustomerSession };
  const { snapshot, loadError } = Route.useLoaderData();

  return (
    // Keyed by user so a different sign-in on this browser remounts with a
    // clean slate (state, import gate) — PII can never carry over.
    <AccountUIProvider
      key={session.userId}
      scope={session.userId}
      initialSnapshot={snapshot}
      initialProfile={{
        name: session.name || "Customer",
        email: session.email || "",
      }}
    >
      <AccountShell loadError={loadError}>
        <Outlet />
      </AccountShell>
    </AccountUIProvider>
  );
}

function AccountShell({ children, loadError }: { children: React.ReactNode; loadError: boolean }) {
  const { profile } = useAccountUI();
  const navigate = useNavigate();
  const { session } = useRouteContext({ from: "/_site/account" }) as { session: CustomerSession };
  useNoticeToast();
  async function onLogout() {
    await serverLogout();
    bustSiteContext();
    setLoggedInHint(false);
    toast.success("You have been signed out.");
    navigate({ to: "/login", search: { next: undefined } });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* Header */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-hero text-lg font-semibold text-primary-foreground">
          {initials(profile.name)}
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">My Account</p>
          <h1 className="truncate font-display text-2xl text-foreground sm:text-3xl">
            Hello, {profile.name}
          </h1>
        </div>
      </header>

      {loadError && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          We couldn't load your saved details right now — refresh the page to try again.
        </div>
      )}

      {/* Secure session notice */}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-gold/30 bg-primary/5 px-4 py-3 text-xs text-foreground/90">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold animate-pulse" />
        <p>
          Secure session active · Authenticated as{" "}
          <span className="font-semibold text-primary">{session.email}</span>. Your actions are
          protected.
        </p>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky site-sticky-with-gap space-y-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.exact }}
                className="account-nav-link flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{
                  className: "account-nav-link-active bg-primary/10 text-primary",
                }}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={onLogout}
              className="mt-2 flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Logout
            </button>
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div className="account-mobile-tabs -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className={cn(
                "account-nav-link flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground",
              )}
              activeProps={{
                className: "account-nav-link-active border-primary/40 bg-primary/10 text-primary",
              }}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={onLogout}
            className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Logout
          </button>
        </div>

        {/* Content */}
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
