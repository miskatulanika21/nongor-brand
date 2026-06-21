import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Prose } from "@/components/PageHero";

// TODO: Final legal/business review required before production launch.

export const Route = createFileRoute("/_site/delivery-policy")({
  head: () => ({
    meta: [
      { title: "Delivery Policy · Nongorr" },
      {
        name: "description",
        content:
          "Nongorr delivery charges and estimates: inside Dhaka ৳80, major cities ৳100, outside Dhaka ৳130. Free delivery when the eligible subtotal reaches ৳3000.",
      },
      { property: "og:title", content: "Delivery Policy · Nongorr" },
      {
        property: "og:description",
        content:
          "Delivery charges, estimates and courier information for Nongorr orders across Bangladesh.",
      },
      { property: "og:url", content: "/delivery-policy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/delivery-policy" }],
  }),
  component: () => (
    <div>
      <PageHero
        eyebrow="Shipping"
        title="Delivery Policy"
        description="Delivery charges, estimates and courier information for orders across Bangladesh."
      />
      <Prose>
        <h2>Delivery charges</h2>
        <ul>
          <li>Inside Dhaka: ৳80</li>
          <li>Major cities: ৳100</li>
          <li>Outside Dhaka: ৳130</li>
          <li>
            <strong>Free delivery</strong> when your eligible subtotal reaches ৳3000
          </li>
        </ul>

        <h2>Delivery estimates</h2>
        <p>
          These are estimates, not guarantees, and can vary by destination and courier availability.
        </p>
        <ul>
          <li>Inside Dhaka: usually 1–3 working days</li>
          <li>Outside Dhaka: usually 3–5 working days</li>
        </ul>
        <p>
          Custom-size and handmade items may require additional preparation time before dispatch.
        </p>

        <h2>Courier &amp; tracking</h2>
        <p>
          Courier and tracking information will be shared when the parcel is assigned and booked.
        </p>

        <h2>Need help?</h2>
        <p>
          For delivery questions, see our <Link to="/faq">FAQ</Link> or{" "}
          <Link to="/contact">contact us</Link>.
        </p>
      </Prose>
    </div>
  ),
});
