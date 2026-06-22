/**
 * /auth/confirm — Email token verification route (server-controlled).
 *
 * Handles:
 *   - Email confirmation after signup (?token_hash=...&type=email)
 *   - Password recovery links (?token_hash=...&type=recovery)
 *   - Magic links (?token_hash=...&type=magiclink)
 *   - Staff invitations (?token_hash=...&type=invite)
 *
 * Architecture choice: beforeLoad + server function.
 *
 * WHY NOT a raw server route:
 *   TanStack Start routes use file-based routing with createFileRoute().
 *   There is no built-in mechanism for raw HTTP handler routes that bypass
 *   the React component lifecycle. A Nitro server route could be added at
 *   the Vinxi/Nitro layer, but that would bypass TanStack's cookie helpers
 *   (getCookies/setCookie) which are the tested path for Supabase SSR
 *   cookie management. Using beforeLoad keeps us within the framework's
 *   request pipeline where cookie mutation is reliable.
 *
 * HOW IT WORKS:
 *   1. beforeLoad runs on the server before any component renders.
 *   2. It calls confirmAuthToken() (in @/lib/auth.api) which validates the
 *      token, calls verifyOtp(), and writes session cookies via the SSR
 *      client. That transaction reuses ONE authenticated client end-to-end so
 *      destination resolution sees the just-established session.
 *   3. On success, it throws a TanStack redirect (HTTP 302).
 *   4. On failure, it passes the error to the component via routeContext.
 *   5. The component only renders in the error case — no useEffect needed.
 *   6. The token is never logged.
 *
 * IDEMPOTENCY: Supabase's verifyOtp is naturally idempotent — a consumed
 * token returns an error on reuse. The redirect on success means the
 * beforeLoad won't re-execute on the destination page.
 */
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { confirmAuthToken } from "@/lib/auth.api";
import { type ConfirmType } from "@/lib/validation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

// ---- Route ------------------------------------------------------------------

export const Route = createFileRoute("/auth/confirm")({
  head: () => ({
    meta: [{ title: "Confirming · Nongorr" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    token_hash: (search.token_hash as string) ?? "",
    type: (search.type as string) ?? "email",
    next: (search.next as string) ?? "",
  }),
  async beforeLoad({ search }) {
    const { token_hash, type, next } = search;

    // Validate inputs before calling server
    const validTypes: ConfirmType[] = ["email", "recovery", "magiclink", "invite"];
    if (!token_hash || !validTypes.includes(type as ConfirmType)) {
      return { confirmError: "Invalid confirmation link." };
    }

    const result = await confirmAuthToken({
      data: { token_hash, type: type as ConfirmType, next: next || undefined },
    });

    if (!result.success) {
      return { confirmError: "Confirmation link is invalid or expired." };
    }

    // Destination is resolved server-side via the central resolver.
    throw redirect({ href: result.destination ?? "/login" });
  },
  component: ConfirmErrorPage,
});

// ---- Error component (only renders on failure) ------------------------------

function ConfirmErrorPage() {
  const navigate = useNavigate();
  const { confirmError } = Route.useRouteContext() as { confirmError?: string };
  const errorMessage = confirmError || "Confirmation failed. Please try again.";

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-primary via-primary/90 to-[hsl(345_55%_18%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="light" />
        </div>
        <div className="rounded-2xl border border-gold/30 bg-card/95 p-8 text-center shadow-card backdrop-blur">
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="mt-4 font-display text-2xl text-foreground">Confirmation Failed</h1>
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
