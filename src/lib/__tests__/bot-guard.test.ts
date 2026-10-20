import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above imports; share the spies via vi.hoisted.
const { checkBotId, safeServerLog } = vi.hoisted(() => ({
  checkBotId: vi.fn(),
  safeServerLog: vi.fn(),
}));

vi.mock("botid/server", () => ({ checkBotId }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => ({ "user-agent": "test", "x-is-human": "token" }),
}));
vi.mock("@/lib/server/security.server", () => ({ safeServerLog }));

import { botIdMode, isBlockedBot } from "@/lib/server/bot-guard.server";

const human = { isBot: false, isHuman: true, isVerifiedBot: false, bypassed: false };
const bot = { isBot: true, isHuman: false, isVerifiedBot: false, bypassed: false };
const goodBot = { isBot: true, isHuman: false, isVerifiedBot: true, bypassed: false };

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  checkBotId.mockReset();
  safeServerLog.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("botIdMode", () => {
  it("defaults to monitor and ignores unknown values", () => {
    vi.stubEnv("BOTID_MODE", "");
    expect(botIdMode()).toBe("monitor");
    vi.stubEnv("BOTID_MODE", "block-everything");
    expect(botIdMode()).toBe("monitor");
    vi.stubEnv("BOTID_MODE", " Enforce ");
    expect(botIdMode()).toBe("enforce");
  });
});

describe("isBlockedBot", () => {
  it("is skipped entirely off Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("BOTID_MODE", "enforce");
    expect(await isBlockedBot("placeOrder")).toBe(false);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("is skipped when mode is off", async () => {
    vi.stubEnv("BOTID_MODE", "off");
    expect(await isBlockedBot("placeOrder")).toBe(false);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("passes the request headers to BotID explicitly", async () => {
    vi.stubEnv("BOTID_MODE", "enforce");
    checkBotId.mockResolvedValue(human);
    await isBlockedBot("login");
    expect(checkBotId).toHaveBeenCalledWith({
      advancedOptions: { headers: { "user-agent": "test", "x-is-human": "token" } },
    });
  });

  it("monitor mode logs a bot but never blocks", async () => {
    vi.stubEnv("BOTID_MODE", "monitor");
    checkBotId.mockResolvedValue(bot);
    expect(await isBlockedBot("placeOrder")).toBe(false);
    expect(safeServerLog).toHaveBeenCalledWith("warn", "BotID flagged request", {
      action: "placeOrder",
      mode: "monitor",
    });
  });

  it("enforce mode blocks a bot", async () => {
    vi.stubEnv("BOTID_MODE", "enforce");
    checkBotId.mockResolvedValue(bot);
    expect(await isBlockedBot("placeOrder")).toBe(true);
  });

  it("never blocks humans or verified good bots", async () => {
    vi.stubEnv("BOTID_MODE", "enforce");
    checkBotId.mockResolvedValueOnce(human).mockResolvedValueOnce(goodBot);
    expect(await isBlockedBot("placeOrder")).toBe(false);
    expect(await isBlockedBot("placeOrder")).toBe(false);
  });

  it("fails open when BotID itself errors", async () => {
    vi.stubEnv("BOTID_MODE", "enforce");
    checkBotId.mockRejectedValue(new Error("botid down"));
    expect(await isBlockedBot("placeOrder")).toBe(false);
    expect(safeServerLog).toHaveBeenCalledWith(
      "error",
      "BotID check failed (failing open)",
      expect.objectContaining({ action: "placeOrder", error: "botid down" }),
    );
  });
});
