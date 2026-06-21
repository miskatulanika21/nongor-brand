/**
 * /admin/login — Compatibility redirect.
 *
 * This route exists solely to preserve old bookmarks and redirect
 * unauthenticated admin-route navigations. It immediately redirects
 * to the canonical login page with ?next=/admin.
 *
 * No login form is rendered here — all authentication goes through /login.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [{ title: "Redirecting… · Nongorr" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  beforeLoad: async () => {
    // Redirect to the canonical login page with admin destination
    throw redirect({ to: "/login", search: { next: "/admin" } });
  },
  component: AdminLoginRedirect,
});

/**
 * Minimal fallback component — should never actually render because
 * beforeLoad always throws a redirect. Exists as a safety net.
 */
function AdminLoginRedirect() {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <p className="text-sm text-muted-foreground">Redirecting to login…</p>
    </div>
  );
}
