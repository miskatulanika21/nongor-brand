/**
 * /auth/confirm — Email token verification route (server-controlled).
 *
 * Handles:
 *   - Email confirmation after signup (?token_hash=...&type=email)
 *   - Password recovery links (?token_hash=...&type=recovery)
 *   - Magic links (?token_hash=...&type=magiclink)
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
 *   2. It calls confirmEmailServer() which validates the token, calls
 *      verifyOtp(), and writes session cookies via the SSR client.
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
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type ConfirmType } from "@/lib/validation";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

// ---- Server function --------------------------------------------------------

const confirmEmailServer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      token_hash: z.string().min(1).max(2048),
      type: z.enum(["email", "recovery", "magiclink"]),
      next: z.string().max(2048).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { createServerSupabaseClient } = await import("@/lib/server/supabase.server");
    const { safeServerLog } = await import("@/lib/server/security.server");
    const { getAuthenticatedIdentity } = await import("@/lib/server/identity.server");
    const { resolvePostLoginDestination } = await import("@/lib/server/login-destination.server");
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

    const { error } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: data.type,
    });

    if (error) {
      safeServerLog("warn", "Email confirmation failed", { type: data.type });
      return { success: false as const, type: data.type, destination: null };
    }

    // Recovery always routes to the password-update screen.
    if (data.type === "recovery") {
      return { success: true as const, type: data.type, destination: "/account/update-password" };
    }

    // Email confirmation / magic link: a verified user now has a session.
    // Resolve the destination via the SAME resolver (confirmed customers land
    // on /account; a linked privileged account would land on /admin).
    const identity = await getAuthenticatedIdentity({ strict: true });
    if (!identity.ok) {
      // Verified but session not established — send to login to sign in.
      return { success: true as const, type: data.type, destination: "/login" };
    }
    const { destination } = resolvePostLoginDestination({
      identity: identity.identity,
      requestedNext: data.next,
    });
    return { success: true as const, type: data.type, destination };
  });

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
    const validTypes: ConfirmType[] = ["email", "recovery", "magiclink"];
    if (!token_hash || !validTypes.includes(type as ConfirmType)) {
      return { confirmError: "Invalid confirmation link." };
    }

    const result = await confirmEmailServer({
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
