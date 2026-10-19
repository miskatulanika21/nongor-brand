import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/security.server", () => ({ safeServerLog: vi.fn() }));

import { __resetPublicCacheForTests, cachedPublic } from "@/lib/server/public-cache.server";

afterEach(() => {
  __resetPublicCacheForTests();
  vi.useRealTimers();
});

describe("cachedPublic", () => {
  it("serves from memory within the TTL", async () => {
    const loader = vi.fn().mockResolvedValue("v1");
    const read = cachedPublic("ttl", 1_000, loader);
    expect(await read()).toBe("v1");
    expect(await read()).toBe("v1");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent misses into one load", async () => {
    let resolve!: (v: string) => void;
    const loader = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const read = cachedPublic("dedupe", 1_000, loader);
    const a = read();
    const b = read();
    resolve("v");
    expect(await Promise.all([a, b])).toEqual(["v", "v"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves the last good value when a refresh fails within maxStale", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce("good").mockRejectedValue(new Error("db down"));
    const read = cachedPublic("stale", 1_000, loader, 60_000);
    expect(await read()).toBe("good");
    vi.advanceTimersByTime(5_000);
    expect(await read()).toBe("good");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("rethrows once the stale value is older than maxStale", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce("good").mockRejectedValue(new Error("db down"));
    const read = cachedPublic("expired", 1_000, loader, 10_000);
    await read();
    vi.advanceTimersByTime(20_000);
    await expect(read()).rejects.toThrow("db down");
  });

  it("rethrows a cold failure (nothing to fall back to)", async () => {
    const read = cachedPublic("cold", 1_000, () => Promise.reject(new Error("boom")));
    await expect(read()).rejects.toThrow("boom");
  });
});
