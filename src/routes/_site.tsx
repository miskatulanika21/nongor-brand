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

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
  // Branded 404 rendered inside the regular site shell (header + footer)
  // for any notFound() thrown by /_site descendants (splat, $slug, etc.).
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      { title: "Page Not Found | Nongorr Studio" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  beforeLoad: async () => {
    // Load session summary for header/menu role display (NOT authorization —
    // just UI hints) and the DB-backed announcement bar, in parallel.
    const [sessionSummary, settings] = await Promise.all([
      getSessionSummary(),
      getPublicSettings(),
    ]);
    return {
      sessionSummary,
      announcement: announcementState(settings),
      publicSettings: settings,
    };
  },
});

function SiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthRoute = pathname === "/login";
  const { sessionSummary, announcement, publicSettings } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean; designation: string; hasAdminAccess: boolean };
    announcement: AnnouncementState;
    publicSettings: PublicSettings | null;
  };
  // Prefer admin-configured contact values; fall back to the static brand default.
  const whatsappNumber = publicSettings?.whatsapp || BRAND.whatsapp;
  const showWhatsappFab = whatsappConfigured || Boolean(publicSettings?.whatsapp);

  return (
    <StoreProvider>
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
