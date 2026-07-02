/**
 * Stage 4 P6 — server-synced wishlist in the site store:
 *   - guests keep the historic localStorage behavior (no server calls)
 *   - signed-in mount merges guest + per-user mirror to the server once,
 *     adopts the canonical list, and purges the guest key ONLY after the
 *     server confirms (a failed sync retries on the next visit)
 *   - signed-in toggles are optimistic, reconcile to the canonical list on
 *     success, and roll back with the server's specific toast on failure
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StoreProvider, useStore, type StoreSession } from "@/lib/store";
import { syncWishlistFn, toggleWishlistFn } from "@/lib/account.api";
import { toast } from "sonner";

vi.mock("@/lib/account.api", () => ({
  syncWishlistFn: vi.fn(),
  toggleWishlistFn: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const m = (fn: unknown) => fn as Mock;

const GUEST_KEY = "nongorr_wishlist";
const USER = "11111111-1111-1111-1111-111111111111";
const MIRROR_KEY = `${GUEST_KEY}::u:${USER}`;

function wrapperFor(session?: StoreSession) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StoreProvider session={session}>{children}</StoreProvider>;
  };
}

const guestWrapper = wrapperFor();
const userWrapper = wrapperFor({ isAuthenticated: true, userId: USER });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("guest wishlist (unchanged by P6)", () => {
  it("persists toggles locally and never talks to the server", async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(["p1"]));
    const { result } = renderHook(() => useStore(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.wishlist).toEqual(["p1"]));
    act(() => result.current.toggleWishlist("p2"));
    expect(result.current.wishlist).toEqual(["p1", "p2"]);
    expect(JSON.parse(localStorage.getItem(GUEST_KEY)!)).toEqual(["p1", "p2"]);

    expect(syncWishlistFn).not.toHaveBeenCalled();
    expect(toggleWishlistFn).not.toHaveBeenCalled();
  });
});

describe("signed-in merge on mount", () => {
  it("unions mirror + guest hearts, adopts the canonical list, purges the guest key", async () => {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(["p3"]));
    localStorage.setItem(GUEST_KEY, JSON.stringify(["p1", "p3", "p2"]));
    let resolveSync!: (v: unknown) => void;
    m(syncWishlistFn).mockReturnValue(new Promise((r) => (resolveSync = r)));

    const { result } = renderHook(() => useStore(), { wrapper: userWrapper });

    // instant paint from the user's mirror while the sync is in flight
    await waitFor(() => expect(result.current.wishlist).toEqual(["p3"]));

    await act(async () => resolveSync({ success: true, codes: ["p3", "p1", "p2"] }));
    await waitFor(() => expect(result.current.wishlist).toEqual(["p3", "p1", "p2"]));
    expect(syncWishlistFn).toHaveBeenCalledTimes(1);
    expect(m(syncWishlistFn).mock.calls[0][0]).toEqual({
      data: { codes: ["p3", "p1", "p2"] }, // mirror first, guest appended, deduped
    });
    expect(localStorage.getItem(GUEST_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(MIRROR_KEY)!)).toEqual(["p3", "p1", "p2"]);
  });

  it("keeps the guest key and local mirror when the sync fails (retry next visit)", async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(["p1"]));
    m(syncWishlistFn).mockResolvedValue({ success: false, error: "nope" });

    const { result } = renderHook(() => useStore(), { wrapper: userWrapper });

    await waitFor(() => expect(syncWishlistFn).toHaveBeenCalledTimes(1));
    expect(result.current.wishlist).toEqual([]); // mirror was empty
    expect(JSON.parse(localStorage.getItem(GUEST_KEY)!)).toEqual(["p1"]);
  });

  it("survives a network reject without purging anything", async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(["p1"]));
    m(syncWishlistFn).mockRejectedValue(new Error("offline"));

    renderHook(() => useStore(), { wrapper: userWrapper });

    await waitFor(() => expect(syncWishlistFn).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem(GUEST_KEY)!)).toEqual(["p1"]);
  });
});

describe("signed-in toggles", () => {
  it("is optimistic and reconciles to the canonical server list", async () => {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(["p1"]));
    m(syncWishlistFn).mockResolvedValue({ success: true, codes: ["p1"] });
    m(toggleWishlistFn).mockResolvedValue({
      success: true,
      wishlisted: true,
      codes: ["p1", "p2"],
    });

    const { result } = renderHook(() => useStore(), { wrapper: userWrapper });
    await waitFor(() => expect(result.current.wishlist).toEqual(["p1"]));

    act(() => result.current.toggleWishlist("p2"));
    expect(result.current.wishlist).toEqual(["p1", "p2"]); // optimistic

    await waitFor(() =>
      expect(m(toggleWishlistFn).mock.calls[0][0]).toEqual({ data: { code: "p2" } }),
    );
    await waitFor(() => expect(result.current.wishlist).toEqual(["p1", "p2"]));
    expect(JSON.parse(localStorage.getItem(MIRROR_KEY)!)).toEqual(["p1", "p2"]);
  });

  it("rolls back and toasts the server's specific message on failure", async () => {
    m(syncWishlistFn).mockResolvedValue({ success: true, codes: [] });
    m(toggleWishlistFn).mockResolvedValue({
      success: false,
      error: "Your wishlist is full (100 items). Remove one first.",
    });

    const { result } = renderHook(() => useStore(), { wrapper: userWrapper });
    await waitFor(() => expect(syncWishlistFn).toHaveBeenCalled());

    act(() => result.current.toggleWishlist("p9"));
    expect(result.current.wishlist).toEqual(["p9"]); // optimistic

    await waitFor(() => expect(result.current.wishlist).toEqual([]));
    expect(toast.error).toHaveBeenCalledWith(
      "Your wishlist is full (100 items). Remove one first.",
    );
  });

  it("rolls back a removal too when the server rejects it", async () => {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(["p1"]));
    m(syncWishlistFn).mockResolvedValue({ success: true, codes: ["p1"] });
    m(toggleWishlistFn).mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useStore(), { wrapper: userWrapper });
    await waitFor(() => expect(result.current.wishlist).toEqual(["p1"]));

    act(() => result.current.toggleWishlist("p1"));
    expect(result.current.wishlist).toEqual([]); // optimistic removal

    await waitFor(() => expect(result.current.wishlist).toEqual(["p1"])); // rolled back
    expect(toast.error).toHaveBeenCalled();
  });
});
