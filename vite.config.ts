import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

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
    // Use Lightning CSS in dev AND build so the static output matches the preview.
    css: { transformer: "lightningcss" },
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
    server: { host: "::", port: 8080 },
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
      viteReact(),
    ],
  };
});
