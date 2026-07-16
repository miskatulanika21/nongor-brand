import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHero, Prose } from "@/components/PageHero";
import { CmsPolicyPage } from "@/components/CmsPolicyPage";
import { getSitePage } from "@/lib/pages.api";
import { BRAND } from "@/lib/brand";
import { absUrl } from "@/lib/site-config";

// TODO: Final legal/business review required before production launch.

const whatsappHref = `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(
  "Hi Nongorr! I have a payment question.",
)}`;

export const Route = createFileRoute("/_site/payment-policy")({
  head: () => ({
    meta: [
      { title: "Payment Policy · Nongorr" },
      {
        name: "description",
        content:
          "How Nongorr payments work: manual bKash payment, TrxID entry and manual verification before order confirmation.",
      },
      { property: "og:title", content: "Payment Policy · Nongorr" },
      {
        property: "og:description",
        content: "Manual bKash payment, TrxID entry and manual verification for Nongorr orders.",
      },
      { property: "og:url", content: absUrl("/payment-policy") },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: absUrl("/payment-policy") }],
  }),
  // CMS-published content (Stage 6 P4); the JSX below stays as the fallback.
  loader: () => getSitePage({ data: { slug: "payment-policy" } }),
  component: PaymentPolicy,
});

function PaymentPolicy() {
  const page = Route.useLoaderData();
  return <CmsPolicyPage page={page} fallback={<StaticPaymentPolicy />} />;
}

function StaticPaymentPolicy() {
  return (
    <div>
      <PageHero
        eyebrow="Payment"
        title="Payment Policy"
        description="How payment and verification currently work for Nongorr orders."
      />
      <Prose>
        <p>
          <strong>Current payment verification is manual.</strong>
        </p>

        <h2>How payment works</h2>
        <ul>
          <li>Payment uses the Nongorr bKash payment number shown during checkout.</li>
          <li>After sending payment, you enter the TrxID (transaction ID) at checkout.</li>
          <li>A payment screenshot is optional supporting information.</li>
          <li>Your payment is then reviewed manually before the order is confirmed.</li>
          <li>Submitting an order does not mean the payment is instantly verified.</li>
        </ul>

        <h2>Wrong amount or payment issues</h2>
        <ul>
          <li>If you sent the wrong amount, contact support before doing anything else.</li>
          <li>
            Do not send a second payment until our team instructs you, so duplicate payments can be
            avoided.
          </li>
        </ul>

        <h2>Keep your details safe</h2>
        <p>
          Pay only to the Nongorr payment number shown during checkout, and keep your TrxID for
          manual verification.
        </p>

        <h2>Need help?</h2>
        <p>
          For payment questions, see our <Link to="/faq">FAQ</Link> or{" "}
          <Link to="/contact">contact us</Link>. You can also{" "}
          <a href={whatsappHref} target="_blank" rel="noreferrer">
            chat on WhatsApp
          </a>
          .
        </p>
      </Prose>
    </div>
  );
}
