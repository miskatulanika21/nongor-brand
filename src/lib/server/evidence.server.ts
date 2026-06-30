/**
 * Payment-evidence repository — SERVER ONLY.
 *
 * Owns the PRIVATE `payment-evidence` Storage bucket (no public read; no anon /
 * authenticated RLS — only the service role can touch it). The customer upload is
 * server-mediated: the app server fn (evidence.api.ts) authorizes the request,
 * then this layer uploads the bytes with the service-role client and calls
 * api.submit_payment_evidence (which re-checks owner/guest scope + status). The
 * admin views a screenshot through a short-lived signed URL minted here.
 *
 * Errors surface as EvidenceError with a stable code (mapped from the RPC's RAISE
 * message); raw SQL never reaches the client.
 */
import { randomUUID, createHash } from "node:crypto";
import { createAdminSupabaseClient } from "./supabase-admin.server";
import {
  EVIDENCE_BUCKET,
  KNOWN_EVIDENCE_ERROR_CODES,
  evidenceExt,
  type EvidenceContentType,
} from "@/lib/evidence-shared";

export class EvidenceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EvidenceError";
  }
}

function throwEvidenceError(error: { message?: string }): never {
  const raw = (error.message ?? "").trim();
  throw new EvidenceError(KNOWN_EVIDENCE_ERROR_CODES.has(raw) ? raw : "internal_error");
}

/**
 * Scope string for a guest order: `guest:<sha256hex(token)>`. The hash must match
 * orders.guest_token_hash, which place_order computes as
 * encode(digest(token,'sha256'),'hex') — so we hash identically here.
 */
export function guestScope(token: string): string {
  return `guest:${createHash("sha256").update(token).digest("hex")}`;
}

/** Upload a screenshot to the private bucket under the order's prefix. */
export async function uploadEvidence(
  orderId: string,
  bytes: Buffer,
  contentType: EvidenceContentType,
): Promise<string> {
  const admin = createAdminSupabaseClient();
  const path = `${orderId}/${randomUUID()}.${evidenceExt(contentType)}`;
  const { error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new EvidenceError("upload_failed");
  return path;
}

export interface SubmitArgs {
  orderId: string;
  trxId: string;
  senderNumber: string | null;
  scope: string;
  screenshotPath: string | null;
}

export interface SubmitResult {
  orderNo: string;
  status: string;
  duplicateWarning: boolean;
}

export async function submitEvidence(args: SubmitArgs): Promise<SubmitResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("submit_payment_evidence", {
    p_order_id: args.orderId,
    p_trx_id: args.trxId,
    p_sender_number: args.senderNumber,
    p_scope: args.scope,
    p_screenshot_path: args.screenshotPath,
  });
  if (error) throwEvidenceError(error);
  const r = data as { order_no: string; status: string; duplicate_trx_id_warning: boolean };
  return {
    orderNo: r.order_no,
    status: r.status,
    duplicateWarning: r.duplicate_trx_id_warning ?? false,
  };
}

/** Mint a short-lived signed download URL for a private-bucket screenshot. */
export async function signEvidence(path: string, expiresInSeconds = 60): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
