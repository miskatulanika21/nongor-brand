import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { absUrl } from "@/lib/site-config";
import { NotFoundPage } from "@/components/NotFoundPage";

// Root not-found fallback: any URL outside the /_site shell (e.g. an
// unmatched /admin/* path) renders the same branded 404 page. Inside
// /_site, /_site.$ catches first and wraps it in the site chrome.
function NotFoundComponent() {
  return (
    <div className="min-h-screen bg-background">
      <NotFoundPage />
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nongorr — Premium Bangladeshi Women's Fashion & Beauty" },
      {
        name: "description",
        content:
          "Nongorr is a premium Bangladeshi women's boutique for handmade kurti, custom-size tailoring, saree, three piece, girls dress and beauty essentials.",
      },
      { name: "author", content: "Nongorr" },
      { property: "og:title", content: "Nongorr — Premium Women's Boutique" },
      {
        property: "og:description",
        content:
          "Elegant kurti, custom-size tailoring & beauty essentials, handcrafted in Bangladesh.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Nongorr" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:image",
        content: absUrl("/og-image.jpg"),
      },
      {
        name: "twitter:image",
        content: absUrl("/og-image.jpg"),
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Nongorr",
          url: "/",
          potentialAction: {
            "@type": "SearchAction",
            target: "/shop?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        }),
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <ConfirmProvider>
        <Outlet />
      </ConfirmProvider>
      {/* Branded boutique toasts — per-type accents come from .nongorr-toast
          (styles.css), so richColors' stock green/red palette stays off. */}
      <Toaster position="top-center" closeButton />
    </QueryClientProvider>
  );
}
