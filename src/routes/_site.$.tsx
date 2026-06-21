import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/NotFoundPage";

// Splat catch-all for any URL inside the public site shell that does not
// match a defined route. Throwing notFound() from the loader propagates
// a real HTTP 404 from TanStack Start's SSR while letting the nearest
// notFoundComponent (the /_site route) render the branded page inside
// the regular header/footer chrome.
export const Route = createFileRoute("/_site/$")({
  loader: () => {
    throw notFound();
  },
  head: () => ({
    meta: [
      { title: "Page Not Found | Nongorr Studio" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: NotFoundPage,
  notFoundComponent: NotFoundPage,
});
