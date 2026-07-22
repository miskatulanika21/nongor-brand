import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, XCircle } from "lucide-react";
import { confirmNewsletterFn } from "@/lib/newsletter.api";
import { Button } from "@/components/ui/button";
import { absUrl } from "@/lib/site-config";

/**
 * Newsletter double opt-in confirmation landing — /newsletter/confirm?token=…
 *
 * Reached from the "Confirm subscription" link in the opt-in email. The loader
 * runs the token server-side (idempotent: a second click reports the same
 * already-confirmed result), then the welcome email is sent from within the
 * server fn on first confirmation. noindex — this is a utility page.
 */
export const Route = createFileRoute("/_site/newsletter/confirm")({
  validateSearch: (s: Record<string, unknown>): { token: string } => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const res = await confirmNewsletterFn({ data: { token: deps.token } });
    return { status: res.status };
  },
  head: () => ({
    meta: [
      { title: "Confirm subscription | Nongorr" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: absUrl("/newsletter/confirm") }],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { status } = Route.useLoaderData();
  const ok = status === "confirmed" || status === "already_confirmed";

  const heading =
    status === "confirmed"
      ? "You're subscribed!"
      : status === "already_confirmed"
        ? "You're already subscribed"
        : "We couldn't confirm this link";

  const body = ok
    ? "Thanks for confirming. You'll be first to hear about new drops, restocks, and members-only offers."
    : "This confirmation link is invalid or has expired. Please subscribe again from the site and we'll send a fresh link.";

  return (
    <div className="mx-auto flex min-h-[55vh] max-w-lg flex-col items-center justify-center px-6 py-20 text-center">
      {ok ? (
        <CheckCircle2 className="size-14 text-gold" aria-hidden />
      ) : (
        <XCircle className="size-14 text-muted-foreground" aria-hidden />
      )}
      <h1 className="mt-6 font-serif text-3xl text-foreground">{heading}</h1>
      <p className="mt-3 text-muted-foreground">{body}</p>
      <Button asChild className="mt-8 bg-gold text-gold-foreground hover:bg-gold/90">
        <Link to="/">Continue shopping</Link>
      </Button>
    </div>
  );
}
