import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Prose } from "@/components/PageHero";
import { CmsPolicyPage } from "@/components/CmsPolicyPage";
import { getSitePage } from "@/lib/pages.api";
import { absUrl } from "@/lib/site-config";

// TODO: Final legal/business review required before production launch.

export const Route = createFileRoute("/_site/cookie-policy")({
  head: () => ({
    meta: [
      { title: "Cookie & Local Storage Policy · Nongorr" },
      {
        name: "description",
        content:
          "How Nongorr uses cookies and browser storage (localStorage and sessionStorage) for cart, wishlist, checkout preferences and local UI state.",
      },
      { property: "og:title", content: "Cookie & Local Storage Policy · Nongorr" },
      {
        property: "og:description",
        content:
          "An honest summary of the browser storage Nongorr currently uses and what is not connected yet.",
      },
      { property: "og:url", content: absUrl("/cookie-policy") },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: absUrl("/cookie-policy") }],
  }),
  // CMS-published content (Stage 6 P4); the JSX below stays as the fallback.
  loader: () => getSitePage({ data: { slug: "cookie-policy" } }),
  component: CookiePolicy,
});

function CookiePolicy() {
  const page = Route.useLoaderData();
  return <CmsPolicyPage page={page} fallback={<StaticCookiePolicy />} />;
}

function StaticCookiePolicy() {
  return (
    <div>
      <PageHero
        eyebrow="Privacy"
        title="Cookie & Local Storage Policy"
        description="A concise, honest summary of the browser storage Nongorr currently uses."
      />
      <Prose>
        <h2>Types of browser storage</h2>
        <ul>
          <li>
            <strong>Cookies</strong> — small files a site or external platform can set in your
            browser.
          </li>
          <li>
            <strong>localStorage</strong> — browser storage that persists until cleared.
          </li>
          <li>
            <strong>sessionStorage</strong> — browser storage that lasts for the current
            tab/session.
          </li>
        </ul>

        <h2>What the current site may store locally</h2>
        <p>
          To make the shopping experience work, the site may store browser-local information for:
        </p>
        <ul>
          <li>Cart contents</li>
          <li>Wishlist (for guests; signed-in wishlists are saved to your account)</li>
          <li>Checkout preferences</li>
          <li>Dismissed announcement state</li>
          <li>Recently viewed items</li>
          <li>Your session, so you stay signed in</li>
        </ul>

        <h2>What this means</h2>
        <ul>
          <li>
            Guest data such as your cart and wishlist is stored in your browser on this device and
            is not synchronized across your devices.
          </li>
          <li>
            When you sign in, your saved addresses, measurement profiles, wishlist and order history
            are stored securely in your account and are available on any device you sign in from.
          </li>
          <li>Clearing your browser storage may remove guest (not signed-in) data.</li>
          <li>
            Current analytics and advertising tracking are not connected, unless that changes later.
          </li>
        </ul>

        <h2>External links</h2>
        <p>
          If you follow a link to an external platform (for example WhatsApp, Facebook or
          Instagram), that platform may set its own cookies under its own policies.
        </p>

        <h2>Need help?</h2>
        <p>
          See our <Link to="/faq">FAQ</Link> or <Link to="/contact">contact us</Link> with any
          questions.
        </p>
      </Prose>
    </div>
  );
}
