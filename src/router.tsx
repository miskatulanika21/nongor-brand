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

/**
 * The current request's CSP nonce, read from the global accessor installed by
 * request-nonce.server.ts. SSR-only: the `import.meta.env.SSR` guard is a build
 * constant, so this whole branch is dead-code-eliminated from the client bundle
 * (which never imports the server-only nonce module).
 */
function readRequestNonce(): string | undefined {
  if (!import.meta.env.SSR) return undefined;
  const getter = (globalThis as Record<string, unknown>)["__nongorr_request_nonce__"] as
    | (() => string | undefined)
    | undefined;
  return getter?.();
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ssr: { nonce: readRequestNonce() },
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
