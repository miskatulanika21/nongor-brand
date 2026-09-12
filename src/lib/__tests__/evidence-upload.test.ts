import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), upload: vi.fn(), storage: vi.fn() }));
vi.mock("@/lib/server/supabase-admin.server", () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }),
    storage: { from: mocks.storage },
  }),
}));
import { guestScope, uploadEvidence } from "@/lib/server/evidence.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.mockReturnValue({ upload: mocks.upload });
  mocks.upload.mockResolvedValue({ error: null });
});
const upload = (scope: string) =>
  uploadEvidence("order-id", Buffer.from("image"), "image/png", scope);

describe("payment screenshot ownership before service-role storage writes", () => {
  it.each([
    [null, "customer"],
    [{ user_id: "owner", status: "pending_payment" }, "other"],
    [{ user_id: null, guest_token_hash: "correct", status: "pending_payment" }, "guest:wrong"],
    [{ user_id: null, guest_token_hash: null, status: "pending_payment" }, "guest:null"],
    [{ user_id: "owner", status: "confirmed" }, "owner"],
  ] as const)(
    "rejects missing, foreign or closed orders without uploading (%j)",
    async (order, scope) => {
      mocks.lookup.mockResolvedValue({ data: order, error: null });
      await expect(upload(scope)).rejects.toThrow();
      expect(mocks.storage).not.toHaveBeenCalled();
    },
  );
  it("fails closed when the ownership lookup fails", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(upload("owner")).rejects.toThrow("internal_error");
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it.each(["pending_payment", "payment_rejected"])(
    "permits the verified owner for %s",
    async (status) => {
      mocks.lookup.mockResolvedValue({ data: { user_id: "owner", status }, error: null });
      await expect(upload("owner")).resolves.toMatch(/^order-id\/.+\.png$/);
      expect(mocks.upload).toHaveBeenCalledOnce();
    },
  );
  it("permits only the matching guest token", async () => {
    const scope = guestScope("secret-token");
    mocks.lookup.mockResolvedValue({
      data: { user_id: null, guest_token_hash: scope.slice(6), status: "pending_payment" },
      error: null,
    });
    await expect(upload(scope)).resolves.toMatch(/^order-id\//);
  });
});
