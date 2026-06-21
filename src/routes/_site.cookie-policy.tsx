import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Prose } from "@/components/PageHero";

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
      { property: "og:url", content: "/cookie-policy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/cookie-policy" }],
  }),
  component: () => (
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
          To make the shopping experience work, the current frontend may store browser-local
          information for:
        </p>
        <ul>
          <li>Cart contents</li>
          <li>Wishlist</li>
          <li>Checkout preferences</li>
          <li>Local mock orders</li>
          <li>Account UI profile</li>
          <li>Saved addresses</li>
          <li>Measurement profiles</li>
          <li>Dismissed announcement state</li>
          <li>Recently viewed items</li>
          <li>Newsletter demo preference, if used</li>
        </ul>

        <h2>What this means</h2>
        <ul>
          <li>This local data is stored in your browser on this device.</li>
          <li>It is not automatically synchronized across your devices.</li>
          <li>Clearing your browser storage may remove it.</li>
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
  ),
});
