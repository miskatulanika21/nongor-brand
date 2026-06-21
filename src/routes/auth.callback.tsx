/**
 * /auth/callback — OAuth (Google/Facebook) PKCE code exchange.
 *
 * The server exchanges the code for a session, then resolves the destination
 * through the SAME centralized identity + destination resolvers used by
 * password login. OAuth never grants a privileged role: role comes only from
 * a staff_profiles row matched by the authenticated user id, so email-matching
 * alone can never elevate. A privileged social login works only when the
 * provider identity is linked to the existing Supabase user. (Spec §22–§23.)
 *
 * The component renders only on error. Authorization codes/tokens are never
 * logged.
 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { completeOAuthCallback } from "@/lib/auth.api";
import { Logo } from "@/components/Logo";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// The OAuth code-exchange transaction lives in @/lib/auth.api
// (completeOAuthCallback) so it reuses one authenticated client end-to-end and
// stays unit-testable. This route only orchestrates the redirect/error UI.

// ---- Route ------------------------------------------------------------------

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [{ title: "Signing in · Nongorr" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    code: (search.code as string) ?? "",
    error: (search.error as string) ?? "",
    error_description: (search.error_description as string) ?? "",
    next: (search.next as string) ?? "",
  }),
  async beforeLoad({ search }) {
    const { code, error: authError, next } = search;

    // The provider returned an error — never echo provider error details.
    if (authError) {
      return { callbackError: "Sign-in was cancelled or failed. Please try again." };
    }
    if (!code) {
      return { callbackError: "Missing authorization code." };
    }

    const result = await completeOAuthCallback({ data: { code, next: next || undefined } });

    if (!result.success) {
      return { callbackError: result.error };
    }
    if (result.redirect) {
      throw redirect({ href: result.redirect });
    }
    throw redirect({ to: "/account" });
  },
  component: CallbackErrorPage,
});

// ---- Error component (only renders on failure) ------------------------------

function CallbackErrorPage() {
  const navigate = useNavigate();
  const { callbackError } = Route.useRouteContext() as { callbackError?: string };
  const errorMessage = callbackError || "Sign-in failed. Please try again.";

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-primary via-primary/90 to-[hsl(345_55%_18%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="light" />
        </div>
        <div className="rounded-2xl border border-gold/30 bg-card/95 p-8 text-center shadow-card backdrop-blur">
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-4 font-display text-2xl text-foreground">Sign-in Failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
          <Button
            onClick={() => navigate({ to: "/login", search: { next: undefined } })}
            variant="outline"
            className="mt-6 w-full"
          >
            Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
}
