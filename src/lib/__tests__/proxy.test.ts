import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({
  next: () => new Response(null, { status: 299, headers: { "x-middleware-next": "1" } }),
}));

import proxy, { forwardableHeaders } from "@/proxy";

afterEach(() => vi.unstubAllGlobals());

describe("forwardableHeaders", () => {
  it("drops credentials but keeps Vercel platform cookies", () => {
    const out = forwardableHeaders(
      new Headers({
        authorization: "Bearer x",
        cookie: "sb-abc-auth-token=secret; _vercel_jwt=pv; theme=dark; __vdpl=dpl_1",
        "accept-language": "bn",
      }),
    );
    expect(out.get("authorization")).toBeNull();
    expect(out.get("cookie")).toBe("_vercel_jwt=pv; __vdpl=dpl_1");
    expect(out.get("accept-language")).toBe("bn");
  });

  it("removes the cookie header entirely when nothing is kept", () => {
    expect(
      forwardableHeaders(new Headers({ cookie: "sb-x-auth-token=s" })).get("cookie"),
    ).toBeNull();
  });
});

describe("proxy", () => {
  it("passes clean URLs and non-GET requests straight through", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await proxy(new Request("https://nongorr.com/shop?q=kurti"))).status).toBe(299);
    expect(
      (await proxy(new Request("https://nongorr.com/?fbclid=1", { method: "POST" }))).status,
    ).toBe(299);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a tracked URL from the clean URL, without encoding headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("<html>cached</html>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-encoding": "br",
          "content-length": "999",
          "x-vercel-cache": "HIT",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await proxy(
      new Request("https://nongorr.com/shop?filter=new&fbclid=A&utm_source=fb", {
        headers: { cookie: "sb-x-auth-token=s" },
      }),
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://nongorr.com/shop?filter=new");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Headers).get("cookie")).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>cached</html>");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-vercel-cache")).toBe("HIT");
  });

  it("falls back to a normal render when the self-fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect((await proxy(new Request("https://nongorr.com/?gclid=1"))).status).toBe(299);
  });
});
