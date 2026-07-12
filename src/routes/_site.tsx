import { createFileRoute, Outlet, useRouterState, useRouteContext } from "@tanstack/react-router";
import { StoreProvider } from "@/lib/store";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { AuthHeader } from "@/components/auth/AuthHeader";
import { AuthFooter } from "@/components/auth/AuthFooter";
import { MessageCircle } from "lucide-react";
import { BRAND, whatsappConfigured } from "@/lib/brand";
import { NotFoundPage } from "@/components/NotFoundPage";
import { getSessionSummary } from "@/lib/auth.api";
import { getPublicSettings } from "@/lib/settings.api";
import {
  announcementState,
  type AnnouncementState,
  type PublicSettings,
} from "@/lib/settings.schema";
import { getCachedSiteContext, setCachedSiteContext } from "@/lib/site-context-cache";

interface SiteContext {
  sessionSummary: Awaited<ReturnType<typeof getSessionSummary>>;
  announcement: AnnouncementState;
  publicSettings: PublicSettings | null;
}

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
  // Branded 404 rendered inside the regular site shell (header + footer)
  // for any notFound() thrown by /_site descendants (splat, $slug, etc.).
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      { title: "Nongorr — Premium Bangladeshi Women's Boutique" },
      // Site-wide indexing gate: keep the whole storefront OUT of search until
      // launch on the real domain (avoids Google indexing the temporary
      // vercel.app URL). Flip by setting VITE_ALLOW_INDEXING=true at go-live.
      // Private sub-routes (admin/account/cart/checkout/404) still carry their
      // own explicit noindex regardless of this flag.
      ...(import.meta.env.VITE_ALLOW_INDEXING === "true"
        ? []
        : [{ name: "robots", content: "noindex,nofollow" } as const]),
    ],
  }),
  beforeLoad: async (): Promise<SiteContext> => {
    // beforeLoad re-runs on EVERY in-site navigation, so on the client the
    // last result is reused for a short TTL (see site-context-cache) instead
    // of paying two server round-trips per click. Login/logout bust it.
    const hit = getCachedSiteContext<SiteContext>();
    if (hit) return hit;
    // Load session summary for header/menu role display (NOT authorization —
    // just UI hints) and the DB-backed announcement bar, in parallel.
    const [sessionSummary, settings] = await Promise.all([
      getSessionSummary(),
      getPublicSettings(),
    ]);
    const value: SiteContext = {
      sessionSummary,
      announcement: announcementState(settings),
      publicSettings: settings,
    };
    setCachedSiteContext(value);
    return value;
  },
});

function SiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthRoute = pathname === "/login";
  const { sessionSummary, announcement, publicSettings } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: {
      isAuthenticated: boolean;
      designation: string;
      hasAdminAccess: boolean;
      userId: string | null;
    };
    announcement: AnnouncementState;
    publicSettings: PublicSettings | null;
  };
  // Prefer admin-configured contact values; fall back to the static brand default.
  const whatsappNumber = publicSettings?.whatsapp || BRAND.whatsapp;
  const showWhatsappFab = whatsappConfigured || Boolean(publicSettings?.whatsapp);

  return (
    <StoreProvider
      session={{ isAuthenticated: sessionSummary.isAuthenticated, userId: sessionSummary.userId }}
    >
      <div className="flex min-h-screen flex-col">
        {isAuthRoute ? (
          <AuthHeader />
        ) : (
          <SiteHeader sessionSummary={sessionSummary} announcement={announcement} />
        )}
        <main className="flex-1">
          <Outlet />
        </main>
        {isAuthRoute ? <AuthFooter /> : <SiteFooter settings={publicSettings} />}
        {/* Only render a real WhatsApp link when a real number is configured.
            Hidden while any Radix dialog/sheet is open (see .site-whatsapp-fab). */}
        {showWhatsappFab && !isAuthRoute && (
          <a
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Chat on WhatsApp"
            className="site-whatsapp-fab group fixed bottom-5 right-5 flex items-center gap-0 rounded-full bg-success py-3 pl-3 pr-3 text-success-foreground shadow-card transition-all hover:gap-2 hover:pr-4 hover:scale-105"
          >
            <MessageCircle className="h-6 w-6 shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-all duration-300 group-hover:max-w-[10rem] group-hover:opacity-100">
              Chat on WhatsApp
            </span>
          </a>
        )}
      </div>
    </StoreProvider>
  );
}
