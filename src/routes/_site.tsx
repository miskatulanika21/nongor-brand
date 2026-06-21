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
    // Load session summary for header/menu role display.
    // This is NOT authorization — just UI hints.
    const sessionSummary = await getSessionSummary();
    return { sessionSummary };
  },
});

function SiteLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthRoute = pathname === "/login";
  const { sessionSummary } = useRouteContext({ from: "/_site" }) as {
    sessionSummary: { isAuthenticated: boolean; designation: string; hasAdminAccess: boolean };
  };

  return (
    <StoreProvider>
      <div className="flex min-h-screen flex-col">
        {isAuthRoute ? <AuthHeader /> : <SiteHeader sessionSummary={sessionSummary} />}
        <main className="flex-1">
          <Outlet />
        </main>
        {isAuthRoute ? <AuthFooter /> : <SiteFooter />}
        {/* Only render a real WhatsApp link when a real number is configured.
            Hidden while any Radix dialog/sheet is open (see .site-whatsapp-fab). */}
        {whatsappConfigured && !isAuthRoute && (
          <a
            href={`https://wa.me/${BRAND.whatsapp}`}
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
