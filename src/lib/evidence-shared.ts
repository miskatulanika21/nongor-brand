/**
 * Payment-evidence shared module — isomorphic (NO server-only imports).
 *
 * Validators + stable error-code map + bucket constants shared by the customer
 * submission server fn, the admin signed-URL viewer, and the checkout/UI. The
 * screenshot is carried as base64 in the validated payload (server-mediated
 * upload — the binary never writes directly to the private bucket from the
 * client). Mirrors the api.submit_payment_evidence argument bounds.
 */
import { z } from "zod";

export const EVIDENCE_BUCKET = "payment-evidence";

export const ALLOWED_EVIDENCE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type EvidenceContentType = (typeof ALLOWED_EVIDENCE_TYPES)[number];

/** Matches the private bucket's file_size_limit (5 MB). */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export function isAllowedEvidenceType(type: string): type is EvidenceContentType {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(type);
}

/** Storage object extension for a given content type. */
export function evidenceExt(type: EvidenceContentType): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

// ── Validators ───────────────────────────────────────────────────────────────

// base64 inflates ~4/3; bound the string so an oversize upload is rejected before
// it is decoded (a second exact byte-length check happens server-side).
const MAX_B64_LEN = Math.ceil((MAX_EVIDENCE_BYTES * 4) / 3) + 1024;

const screenshotSchema = z.object({
  base64: z.string().min(1).max(MAX_B64_LEN),
  contentType: z.enum(ALLOWED_EVIDENCE_TYPES),
});

export const submitEvidenceSchema = z.object({
  orderId: z.string().uuid(),
  trxId: z.string().trim().min(1).max(100),
  senderNumber: z.string().trim().max(40).optional(),
  /** Raw guest token (in-memory from placement); never the URL. */
  guestToken: z.string().trim().min(1).max(200).optional(),
  screenshot: screenshotSchema.optional(),
});

export const evidenceUrlSchema = z.object({
  orderId: z.string().uuid(),
  path: z.string().trim().min(1).max(400),
});

export type SubmitEvidenceInput = z.infer<typeof submitEvidenceSchema>;
export type EvidenceUrlInput = z.infer<typeof evidenceUrlSchema>;

// ── Stable error codes → safe messages ───────────────────────────────────────

export const EVIDENCE_ERROR_MESSAGES: Record<string, string> = {
  order_not_found: "That order could not be found.",
  order_not_owned: "This order isn't associated with your session.",
  evidence_already_submitted: "Payment proof was already submitted for this order.",
  invalid_trx_id: "Please enter a valid transaction ID (TrxID).",
  payment_not_found: "No payment is awaiting proof on this order.",
  invalid_media_type: "Please upload a JPEG, PNG or WebP image.",
  file_too_large: "That image is too large. Maximum size is 5 MB.",
  upload_failed: "Could not upload your screenshot. Please try again.",
  no_scope: "We couldn't verify your session for this order.",
};

export const KNOWN_EVIDENCE_ERROR_CODES = new Set(Object.keys(EVIDENCE_ERROR_MESSAGES));

const GENERIC_EVIDENCE_ERROR = "Could not submit your payment proof. Please try again.";

export function evidenceErrorMessage(code: string | null | undefined): string {
  if (!code) return GENERIC_EVIDENCE_ERROR;
  return EVIDENCE_ERROR_MESSAGES[code] ?? GENERIC_EVIDENCE_ERROR;
}

// ── Browser helper: file → bounded base64 payload ────────────────────────────

/**
 * Encode a File to the base64 screenshot payload, or null when the type is not
 * allowed / it exceeds the size limit. Chunked encoding avoids a call-stack
 * overflow on large byte arrays. Browser-only (uses btoa); guarded for SSR.
 */
export async function fileToEvidencePayload(
  file: File,
): Promise<{ base64: string; contentType: EvidenceContentType } | null> {
  if (!isAllowedEvidenceType(file.type)) return null;
  if (file.size > MAX_EVIDENCE_BYTES) return null;
  if (typeof btoa === "undefined") return null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { base64: btoa(binary), contentType: file.type };
}
