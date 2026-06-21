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
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---- Server function --------------------------------------------------------

const completeOAuthCallback = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string().min(1), next: z.string().max(2048).optional() }))
  .handler(async ({ data }) => {
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { safeServerLog } = await import("@/lib/server/security.server");
    const { getAuthenticatedIdentity, invalidateSession } =
      await import("@/lib/server/identity.server");
    const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
    const { writeAudit } = await import("@/lib/server/audit.server");
    const { setResponseHeaders } = await import("@tanstack/react-start/server");

    try {
      setResponseHeaders({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        Expires: "0",
      } as unknown as Headers);
    } catch {
      // Ignore context errors in tests
    }

    const supabase = createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(data.code);
    if (error) {
      safeServerLog("warn", "PKCE code exchange failed");
      return {
        success: false as const,
        redirect: null,
        error: "Sign-in failed. Please try again.",
      };
    }

    // Same identity resolution as password login — fail closed.
    const result = await getAuthenticatedIdentity({ strict: true });
    if (!result.ok) {
      await invalidateSession();
      if (result.reason === "inactive_staff") {
        await writeAudit({
          action: "auth.login.denied",
          actorId: null,
          metadata: { reason: "inactive_staff", via: "oauth" },
        });
        return { success: true as const, redirect: "/login?notice=inactive", error: null };
      }
      return { success: true as const, redirect: "/login?notice=verify", error: null };
    }

    const { destination } = resolvePostLoginDestination({
      identity: result.identity,
      requestedNext: data.next,
    });

    if (result.identity.kind === "staff") {
      await writeAudit({
        action: "auth.login.success",
        actorId: result.identity.userId,
        metadata: { role: result.identity.role, via: "oauth" },
      });
    }

    return { success: true as const, redirect: destination, error: null };
  });

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
