import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/security.server", () => ({ safeServerLog: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  for (const key of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
  ]) {
    vi.stubEnv(key, "");
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("shared Redis configuration", () => {
  it("Vercel integration counters survive an application instance restart", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://qa.example");
    vi.stubEnv("KV_REST_API_TOKEN", "qa-token");
    let count = 0;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ result: ++count }, { result: 1 }])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await import("../server/rate-limit.server");
    for (let i = 0; i < 8; i++)
      expect((await first.checkRateLimit("login", ["qa"])).allowed).toBe(true);
    vi.resetModules();
    const second = await import("../server/rate-limit.server");
    expect((await second.checkRateLimit("login", ["qa"])).allowed).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qa.example/pipeline",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer qa-token" }),
      }),
    );
  });
  it("does not combine an incomplete direct pair with the integration token", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://unrelated.example");
    vi.stubEnv("KV_REST_API_URL", "https://integration.example");
    vi.stubEnv("KV_REST_API_TOKEN", "integration-token");
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ result: 1 }, { result: 1 }])),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { checkRateLimit } = await import("../server/rate-limit.server");
    await checkRateLimit("login", ["qa"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://integration.example/pipeline",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer integration-token" }),
      }),
    );
  });
});
