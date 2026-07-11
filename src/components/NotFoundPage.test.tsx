/**
 * Smoke test for the branded 404 experience.
 *
 * The shared NotFoundPage that the root + /_site splat + product $slug
 * not-found boundaries all render exposes the branded copy and the recovery
 * links to Home and Shop. (The old "invalid slug → getProduct undefined" case
 * was removed with the mock PRODUCTS seed — the PDP loader is DB-backed via
 * getProductDetail, and its not-found behavior belongs to the route/e2e layer,
 * not a mock lookup.)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundPage } from "./NotFoundPage";

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
});
