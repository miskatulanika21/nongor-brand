import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { BrandLoader } from "./components/BrandLoader";
import { routeTree } from "./routeTree.gen";

/** Shown only when a navigation blocks past defaultPendingMs (rare). */
function RoutePending() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <BrandLoader size="lg" label="Nongorr" />
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Run the whole match pipeline (chunk + beforeLoad + loader) on link
    // hover/touchstart so most clicks commit instantly. The default
    // preloadStaleTime (30s) lets the preloaded match be reused at commit —
    // the previous explicit 0 discarded every preload as instantly stale.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 300,
    defaultPendingMinMs: 200,
  });

  return router;
};
