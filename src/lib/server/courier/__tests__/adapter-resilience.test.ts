/**
 * Courier adapter resilience — checkStatus must never throw.
 *
 * Found by driving the real SteadFast API on 2026-07-17: polling a consignment
 * that isn't ours returns the bare text "Unauthorized Access" with HTTP 401, not
 * JSON. The adapters called resp.json() unguarded, so a status poll threw a
 * SyntaxError into the caller instead of returning a result. These tests pin the
 * defensive parsing — no network, safe for CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import process from "node:process";

const ENV_SNAPSHOT = { ...process.env };

function mockFetchOnce(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

beforeEach(() => {
  vi.resetModules();
  process.env.STEADFAST_API_KEY = "test-key";
  process.env.STEADFAST_SECRET_KEY = "test-secret";
  process.env.STEADFAST_BASE_URL = "https://portal.packzy.com/api/v1";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV_SNAPSHOT };
});

describe("steadfastAdapter.checkStatus", () => {
  it("returns 'unknown' instead of throwing on a non-JSON body", async () => {
    // The exact live response for a consignment that isn't ours.
    mockFetchOnce("Unauthorized Access", 401);
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.checkStatus("1");

    expect(r.status).toBe("unknown");
    expect(r.updatedAt).toBeNull();
    expect(r.rawResponse).toMatchObject({ error: "Unauthorized Access", httpStatus: 401 });
  });

  it("parses a documented success response", async () => {
    mockFetchOnce(JSON.stringify({ status: 200, delivery_status: "in_review" }));
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.checkStatus("1424107");

    expect(r.status).toBe("in_review");
  });

  it("does not throw when the network itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND portal.steadfast.com.bd");
      }),
    );
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");

    const r = await steadfastAdapter.checkStatus("1");

    expect(r.status).toBe("unknown");
    expect(r.rawResponse).toMatchObject({ error: expect.stringContaining("ENOTFOUND") });
  });

  it("maps a failed poll to a non-transitioning status", async () => {
    mockFetchOnce("<html>502 Bad Gateway</html>", 502);
    const { steadfastAdapter } = await import("@/lib/server/courier/steadfast.server");
    const { mapCourierStatusToInternal } = await import("@/lib/courier-shared");

    const r = await steadfastAdapter.checkStatus("1");

    // A failed poll must never be mistaken for a delivery outcome: "unknown" is
    // a documented SteadFast status that records an event without moving the order.
    expect(mapCourierStatusToInternal("steadfast", r.status)).toBe("unknown");
  });
});
