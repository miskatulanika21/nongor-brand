import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

// Plain TanStack Start + React + Tailwind Vite config.
// VITE_* env vars are exposed to the client by Vite natively via import.meta.env.
export default defineConfig(({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  return {
    // For `vite build --mode development`: keep the client on dev React (so the
    // RSC SSR runtime doesn't try to resolve jsxDEV) and preserve names.
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    // Baked at build time: Vercel sets VERCEL=1, enabling /_vercel/image URLs
    // in <OptimizedImage>. Local dev/preview and CI serve original files.
    define: {
      "import.meta.env.VERCEL_IMAGES": JSON.stringify(process.env.VERCEL ? "1" : ""),
    },
    // Use Lightning CSS in dev AND build so the static output matches the preview.
    css: { transformer: "lightningcss" },
    // Target modern evergreen browsers so the build stops shipping legacy-JS
    // transpilation (async/spread/optional-chaining helpers) to browsers that
    // run it natively — smaller bundles + faster parse. Safe for the audience
    // (2020+ mobile Chrome/Safari). Skipped for the dev-mode build.
    ...(isDevBuild ? {} : { build: { target: "es2020" } }),
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      // Avoid duplicate React / Query copies (hydration + context safety).
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    // strictPort: if 8080 is taken, fail fast instead of drifting to 8081 —
    // the CSRF origin allowlist is pinned to VITE_SITE_URL, so a drifted port
    // makes every server function reject with "Invalid request origin".
    server: { host: "::", port: 8080, strictPort: true },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Fail the build if client code imports a server-only module — keeps the
        // src/lib/server/** and `server-only` boundary enforced at build time.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
        // SSR entry → src/server.ts (our security-header + error wrapper).
        server: { entry: "server" },
      }),
      nitro(),
      viteReact(),
    ],
  };
});
