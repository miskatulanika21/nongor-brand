import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, XCircle } from "lucide-react";
import { unsubscribeNewsletterFn } from "@/lib/newsletter.api";
import { Button } from "@/components/ui/button";
import { absUrl } from "@/lib/site-config";

/**
 * Newsletter unsubscribe landing — /newsletter/unsubscribe?token=…
 *
 * Reached from the "Unsubscribe" link/List-Unsubscribe header in marketing email.
 * The loader processes the stable per-subscriber token server-side (idempotent),
 * so a repeat click simply reports "unsubscribed" again. noindex utility page.
 */
export const Route = createFileRoute("/_site/newsletter/unsubscribe")({
  validateSearch: (s: Record<string, unknown>): { token: string } => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const res = await unsubscribeNewsletterFn({ data: { token: deps.token } });
    return { status: res.status };
  },
  head: () => ({
    meta: [{ title: "Unsubscribe | Nongorr" }, { name: "robots", content: "noindex, nofollow" }],
    links: [{ rel: "canonical", href: absUrl("/newsletter/unsubscribe") }],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { status } = Route.useLoaderData();
  const ok = status === "unsubscribed";

  return (
    <div className="mx-auto flex min-h-[55vh] max-w-lg flex-col items-center justify-center px-6 py-20 text-center">
      {ok ? (
        <CheckCircle2 className="size-14 text-gold" aria-hidden />
      ) : (
        <XCircle className="size-14 text-muted-foreground" aria-hidden />
      )}
      <h1 className="mt-6 font-serif text-3xl text-foreground">
        {ok ? "You've been unsubscribed" : "We couldn't process this link"}
      </h1>
      <p className="mt-3 text-muted-foreground">
        {ok
          ? "You won't receive any more newsletter emails from us. Changed your mind? You can re-subscribe any time from the footer of our site."
          : "This unsubscribe link is invalid. If you keep receiving emails, reply to any of them and we'll remove you."}
      </p>
      <Button asChild className="mt-8" variant="outline">
        <Link to="/">Back to Nongorr</Link>
      </Button>
    </div>
  );
}
