import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Minimal Vitest config — isolated from the TanStack Start app config so
// router/nitro plugins don't try to run during unit tests.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // `text-summary` for the CI log, `html` for local drilling, `lcov` for
      // external dashboards, `json-summary` so the % can be asserted / badged.
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/__tests__/**",
        "src/routeTree.gen.ts", // generated
        "src/**/*.d.ts",
        "src/**/*.gen.ts",
      ],
      // Regression floor — a RATCHET, not a target. Set ~1pt under the measured
      // baseline (2026-07-20: stmts 19.6 / branch 16.8 / fn 15.3 / lines 19.5).
      // The number is low by design: UI primitives and route components are
      // exercised by the Playwright E2E + axe suites, not Vitest, which
      // concentrates on the isomorphic logic in src/lib. Raise these as unit
      // coverage grows; never lower them to make a red build pass.
      thresholds: {
        statements: 18,
        branches: 15,
        functions: 14,
        lines: 18,
      },
    },
  },
});
