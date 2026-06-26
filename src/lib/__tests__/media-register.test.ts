/**
 * F-06 — upload-intent verification for registerUploaded.
 *
 * The signed upload URL only constrains where the browser PUTs; registration
 * still arrives with client-supplied fields. registerUploaded must therefore:
 *   - reject a path with no real Storage object (`upload_not_found`);
 *   - record Storage's TRUE size + content-type, ignoring client claims;
 *   - re-derive the public URL server-side (never trust a client-passed url),
 *     so a forged call cannot inject an off-bucket URL into the catalogue.
 *
 * Only the service-role client is mocked; the real verification logic runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createAdminMock } = vi.hoisted(() => ({ createAdminMock: vi.fn() }));
vi.mock("@/lib/server/supabase-admin.server", () => ({
  createAdminSupabaseClient: createAdminMock,
}));

import { registerUploaded, MediaError } from "@/lib/server/media.server";

type ListResult = { data: Array<{ name: string; metadata: unknown }> | null; error: unknown };

function buildAdmin(listResult: ListResult) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: {
      id: "m1",
      storage_path: "p",
      public_url: "u",
      file_name: "f",
      content_type: "image/png",
    },
    error: null,
  }));
  const list = vi.fn(async () => listResult);
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.example/${path}` },
  }));
  const admin = {
    storage: { from: () => ({ list, getPublicUrl }) },
    schema: () => ({ rpc }),
  };
  createAdminMock.mockReturnValue(admin);
  return { rpc, list, getPublicUrl };
}

const baseInput = {
  path: "2026/06/abc-photo.png",
  publicUrl: "https://attacker.example/evil.png", // client-supplied; must be ignored
  fileName: "photo.png",
  contentType: "image/png",
  sizeBytes: 999, // client-supplied; must be ignored
  width: 640,
  height: 480,
};

describe("registerUploaded (F-06)", () => {
  beforeEach(() => createAdminMock.mockReset());

  it("rejects a path with no Storage object", async () => {
    const { rpc } = buildAdmin({ data: [], error: null });
    await expect(registerUploaded(baseInput, "actor")).rejects.toMatchObject({
      code: "upload_not_found",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records Storage's true size/type and a server-derived url", async () => {
    const { rpc } = buildAdmin({
      data: [{ name: "abc-photo.png", metadata: { size: 12345, mimetype: "image/webp" } }],
      error: null,
    });
    await registerUploaded(baseInput, "actor");
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = rpc.mock.calls[0][1];
    expect(args.p_size_bytes).toBe(12345); // not the client's 999
    expect(args.p_content_type).toBe("image/webp"); // not the client's image/png
    expect(args.p_url).toBe("https://cdn.example/2026/06/abc-photo.png"); // not attacker url
  });

  it("rejects when Storage reports a non-image content-type", async () => {
    const { rpc } = buildAdmin({
      data: [{ name: "abc-photo.png", metadata: { size: 10, mimetype: "text/html" } }],
      error: null,
    });
    await expect(registerUploaded(baseInput, "actor")).rejects.toBeInstanceOf(MediaError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falls back to client size/type only when Storage omits metadata", async () => {
    const { rpc } = buildAdmin({
      data: [{ name: "abc-photo.png", metadata: {} }],
      error: null,
    });
    await registerUploaded(baseInput, "actor");
    const args = rpc.mock.calls[0][1];
    expect(args.p_size_bytes).toBe(999);
    expect(args.p_content_type).toBe("image/png");
  });
});
