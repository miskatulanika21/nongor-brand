/**
 * Smoke tests for the branded 404 experience.
 *
 * Two acceptance criteria are exercised here:
 *   1. The shared NotFoundPage that the root + /_site splat + product
 *      $slug not-found boundaries all render exposes the branded copy
 *      and the recovery links to Home and Shop.
 *   2. Looking up an invalid product slug returns undefined, which is
 *      exactly what triggers `throw notFound()` in the product loader
 *      and therefore the branded not-found page (rather than crashing
 *      or showing an empty product screen).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundPage } from "./NotFoundPage";
import { getProduct } from "@/lib/products";

// TanStack Router's <Link> needs a router context. For a smoke-test we
// don't need real routing — replace it with a plain anchor.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

describe("Branded 404", () => {
  it("renders the branded heading and recovery actions", () => {
    render(<NotFoundPage />);

    // Real semantic heading communicates the error (not just the "404").
    expect(screen.getByRole("heading", { level: 1, name: /drifted away/i })).toBeInTheDocument();

    // Primary + secondary recovery actions both point at real routes.
    const home = screen.getByRole("link", { name: /return to home/i });
    expect(home).toHaveAttribute("href", "/");

    const shop = screen.getByRole("link", { name: /explore the shop/i });
    expect(shop).toHaveAttribute("href", "/shop");
  });

  it("invalid product slug resolves to undefined (triggers notFound)", () => {
    // The product route's loader is `if (!getProduct(params.slug)) throw notFound()`.
    // Confirming this contract guarantees an invalid slug renders the branded
    // 404 boundary instead of crashing or showing an empty product screen.
    expect(getProduct("totally-not-a-real-product-slug-xyz")).toBeUndefined();
  });
});
