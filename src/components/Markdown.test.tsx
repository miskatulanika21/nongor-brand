// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { Markdown } from "@/components/Markdown";

/** Markdown emits router <Link>s, so mount inside a minimal memory router. */
function renderMd(source: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Markdown source={source} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router as never} />);
}

describe("Markdown", () => {
  it("renders headings, paragraphs and lists", async () => {
    const { findByRole, container } = renderMd(
      "## Charges\n\nSome intro text.\n\n- Inside Dhaka: ৳80\n- Outside: ৳130\n\n1. First\n2. Second",
    );
    expect(await findByRole("heading", { level: 2 })).toHaveTextContent("Charges");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("p")).toHaveTextContent("Some intro text.");
  });

  it("renders bold, italic and internal/external links", async () => {
    const { findByRole, container } = renderMd(
      "## T\n\n**Free delivery** and *fast*. See [FAQ](/faq) or [WhatsApp](https://wa.me/880).",
    );
    await findByRole("heading", { level: 2 });
    expect(container.querySelector("strong")).toHaveTextContent("Free delivery");
    expect(container.querySelector("em")).toHaveTextContent("fast");
    const links = Array.from(container.querySelectorAll("a"));
    const internal = links.find((a) => a.getAttribute("href") === "/faq");
    const external = links.find((a) => a.getAttribute("href") === "https://wa.me/880");
    expect(internal).toBeTruthy();
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toContain("noopener");
  });

  it("neutralizes unsafe protocols and raw HTML", async () => {
    const { findByRole, container } = renderMd(
      "## T\n\nClick [here](javascript:alert(1)) now.\n\n<script>alert(2)</script>",
    );
    await findByRole("heading", { level: 2 });
    // javascript: link degrades to plain text — no anchor rendered for it
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("here");
    // raw HTML is inert text, not an element
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(2)</script>");
  });

  it("joins wrapped lines into one paragraph / list item", async () => {
    const { findByRole, container } = renderMd(
      "## T\n\nLine one\ncontinues here.\n\n- item starts\n  and wraps",
    );
    await findByRole("heading", { level: 2 });
    expect(container.querySelector("p")).toHaveTextContent("Line one continues here.");
    expect(container.querySelector("li")).toHaveTextContent("item starts and wraps");
  });
});
