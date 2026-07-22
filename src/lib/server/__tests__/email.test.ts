/**
 * Unit tests for the shared email layer (email.server.ts).
 *
 * Focus on the pure, security-relevant bits: HTML escaping (untrusted values like
 * a customer name flow into the branded template) and the branded layout's
 * structure (heading, CTA, optional unsubscribe link, and the plain-text fallback).
 * Network sending is not exercised here.
 */
import { describe, expect, it } from "vitest";
import { escapeHtml, renderBrandedEmail } from "../email.server";

describe("escapeHtml", () => {
  it("neutralizes HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Order NGR-1024 is on its way")).toBe("Order NGR-1024 is on its way");
  });
});

describe("renderBrandedEmail", () => {
  it("escapes interpolated values in the HTML body", () => {
    const { html } = renderBrandedEmail({
      heading: "Hi <b>there</b>",
      paragraphs: ["Your code is <secret> & safe"],
    });
    expect(html).toContain("Hi &lt;b&gt;there&lt;/b&gt;");
    expect(html).toContain("Your code is &lt;secret&gt; &amp; safe");
    // The raw, unescaped attacker markup must never appear.
    expect(html).not.toContain("<b>there</b>");
  });

  it("renders a CTA button linking to the given url", () => {
    const { html, text } = renderBrandedEmail({
      heading: "Delivered",
      paragraphs: ["Your order arrived."],
      cta: { label: "Track your order", url: "https://nongorr.com/track" },
    });
    expect(html).toContain('href="https://nongorr.com/track"');
    expect(html).toContain("Track your order");
    // Plain-text fallback carries the same link + label.
    expect(text).toContain("Track your order: https://nongorr.com/track");
  });

  it("adds a clickable unsubscribe link only when requested", () => {
    const withUnsub = renderBrandedEmail({
      heading: "Welcome",
      paragraphs: ["You're in."],
      unsubscribeUrl: "https://nongorr.com/newsletter/unsubscribe?token=abc",
    });
    expect(withUnsub.html).toContain('href="https://nongorr.com/newsletter/unsubscribe?token=abc"');
    expect(withUnsub.html).toContain("Unsubscribe");

    const withoutUnsub = renderBrandedEmail({
      heading: "Order update",
      paragraphs: ["On the way."],
    });
    expect(withoutUnsub.html).not.toContain("Unsubscribe");
  });

  it("produces a plain-text fallback that includes heading and body", () => {
    const { text } = renderBrandedEmail({
      heading: "Your order is on its way",
      paragraphs: ["Hi Salman, good news.", "Tracking code: XYZ"],
    });
    expect(text).toContain("Your order is on its way");
    expect(text).toContain("Hi Salman, good news.");
    expect(text).toContain("Tracking code: XYZ");
    expect(text).toContain("Nongorr");
  });
});
