import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Prose } from "@/components/PageHero";
import { BRAND } from "@/lib/brand";

// TODO: Final legal/business review required before production launch.

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hi Nongorr! I have an authenticity concern.",
)}`;

export const Route = createFileRoute("/_site/authenticity-policy")({
  head: () => ({
    meta: [
      { title: "Cosmetics Authenticity Policy · Nongorr" },
      {
        name: "description",
        content:
          "How Nongorr reviews cosmetics packaging, batch and expiry information before dispatch, plus customer checking and complaint guidance.",
      },
      { property: "og:title", content: "Cosmetics Authenticity Policy · Nongorr" },
      {
        property: "og:description",
        content:
          "Nongorr's cautious authenticity commitment for cosmetics, with checking and complaint guidance.",
      },
      { property: "og:url", content: "/authenticity-policy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/authenticity-policy" }],
  }),
  component: () => (
    <div>
      <PageHero
        eyebrow="Authenticity"
        title="Cosmetics Authenticity Policy"
        description="Our commitment and the checks we aim to make before dispatching cosmetics."
      />
      <Prose>
        <h2>Our commitment</h2>
        <p>
          Nongorr aims to source cosmetics through trusted suppliers and review available packaging,
          batch and expiry information. The information available can vary by product and supplier.
        </p>

        <h2>What we aim to check before dispatch</h2>
        <ul>
          <li>Packaging and seal condition.</li>
          <li>Batch or lot information where available.</li>
          <li>Expiry or PAO (period-after-opening) information where available.</li>
          <li>Supplier or importer records where available.</li>
          <li>General product condition before the parcel is sent.</li>
        </ul>

        <h2>Checking your product on arrival</h2>
        <ul>
          <li>Inspect the outer packaging and seals before opening.</li>
          <li>Check batch and expiry markings against the product where shown.</li>
          <li>Keep your invoice or order ID until you are satisfied.</li>
        </ul>

        <h2>If you have an authenticity concern</h2>
        <ul>
          <li>Stop using the product.</li>
          <li>Retain the packaging and any visible batch/expiry details.</li>
          <li>Keep your order ID.</li>
          <li>Take clear photos of the product, packaging and markings.</li>
          <li>
            <Link to="/contact">Contact support</Link> so the concern can be reviewed.
          </li>
        </ul>

        <h2>Need help?</h2>
        <p>
          See our <Link to="/faq">FAQ</Link> or{" "}
          <a href={whatsappHref} target="_blank" rel="noreferrer">
            chat on WhatsApp
          </a>
          .
        </p>
      </Prose>
    </div>
  ),
});
