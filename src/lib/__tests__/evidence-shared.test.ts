import { describe, it, expect } from "vitest";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  isAllowedEvidenceType,
  evidenceExt,
  submitEvidenceSchema,
  evidenceUrlSchema,
  evidenceErrorMessage,
  EVIDENCE_ERROR_MESSAGES,
} from "@/lib/evidence-shared";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("evidence content types", () => {
  it("guards + maps extensions", () => {
    expect(isAllowedEvidenceType("image/png")).toBe(true);
    expect(isAllowedEvidenceType("image/gif")).toBe(false);
    expect(isAllowedEvidenceType("application/pdf")).toBe(false);
    expect(evidenceExt("image/png")).toBe("png");
    expect(evidenceExt("image/webp")).toBe("webp");
    expect(evidenceExt("image/jpeg")).toBe("jpg");
  });

  it("exposes exactly the three image types", () => {
    expect([...ALLOWED_EVIDENCE_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});

describe("submitEvidenceSchema", () => {
  const base = { orderId: UUID, trxId: "TRX12345" };

  it("accepts the minimal payload and a full one", () => {
    expect(submitEvidenceSchema.safeParse(base).success).toBe(true);
    expect(
      submitEvidenceSchema.safeParse({
        ...base,
        senderNumber: "01711111111",
        guestToken: "tok_abc",
        screenshot: { base64: "QUJD", contentType: "image/png" },
      }).success,
    ).toBe(true);
  });

  it("rejects bad uuid / empty trx / bad content type", () => {
    expect(submitEvidenceSchema.safeParse({ ...base, orderId: "nope" }).success).toBe(false);
    expect(submitEvidenceSchema.safeParse({ ...base, trxId: "" }).success).toBe(false);
    expect(
      submitEvidenceSchema.safeParse({
        ...base,
        screenshot: { base64: "QUJD", contentType: "image/gif" },
      }).success,
    ).toBe(false);
  });

  it("rejects a base64 payload beyond the size bound", () => {
    const huge = "A".repeat(Math.ceil((MAX_EVIDENCE_BYTES * 4) / 3) + 2048);
    expect(
      submitEvidenceSchema.safeParse({
        ...base,
        screenshot: { base64: huge, contentType: "image/jpeg" },
      }).success,
    ).toBe(false);
  });
});

describe("evidenceUrlSchema", () => {
  it("requires a uuid order id + non-empty path", () => {
    expect(evidenceUrlSchema.safeParse({ orderId: UUID, path: `${UUID}/a.png` }).success).toBe(
      true,
    );
    expect(evidenceUrlSchema.safeParse({ orderId: "x", path: "a" }).success).toBe(false);
    expect(evidenceUrlSchema.safeParse({ orderId: UUID, path: "" }).success).toBe(false);
  });
});

describe("evidenceErrorMessage", () => {
  it("maps known codes + falls back", () => {
    expect(evidenceErrorMessage("evidence_already_submitted")).toContain("already submitted");
    expect(evidenceErrorMessage("order_not_owned")).toContain("your session");
    expect(evidenceErrorMessage("file_too_large")).toContain("5 MB");
    expect(evidenceErrorMessage("internal_error")).toContain("try again");
    expect(evidenceErrorMessage(undefined)).toContain("try again");
  });

  it("never leaks raw SQL for any known code", () => {
    for (const code of Object.keys(EVIDENCE_ERROR_MESSAGES)) {
      const msg = evidenceErrorMessage(code);
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("SQLERRM");
      expect(msg).not.toContain("RAISE");
    }
  });
});

describe("evidence API + server wiring", () => {
  it("exposes the customer + admin server fns", async () => {
    const api = await import("@/lib/evidence.api");
    expect(typeof api.submitPaymentEvidenceFn).toBe("function");
    expect(typeof api.getEvidenceUrlFn).toBe("function");
  });

  it("EvidenceError carries a code mapped by evidenceErrorMessage", async () => {
    const { EvidenceError } = await import("@/lib/server/evidence.server");
    const e = new EvidenceError("upload_failed");
    expect(e).toBeInstanceOf(Error);
    expect(evidenceErrorMessage(e.code)).toContain("upload");
  });

  it("defines a paymentEvidence rate-limit policy", async () => {
    const { RATE_LIMITS } = await import("@/lib/server/rate-limit.server");
    expect(RATE_LIMITS.paymentEvidence).toBeDefined();
    expect(RATE_LIMITS.paymentEvidence.limit).toBeGreaterThan(0);
  });
});
