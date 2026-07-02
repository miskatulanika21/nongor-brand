/**
 * Audit logging — records security-relevant events to public.audit_logs.
 *
 * audit_logs grants INSERT only to service_role, so writes go through the
 * admin client. Callers must pass the REAL actor id (the authenticated user
 * performing the action) — never the target. For system-run tasks use the
 * documented SYSTEM_ACTOR sentinel (null actor + system flag in metadata).
 *
 * Never store secrets: passwords, tokens, OAuth codes, full API keys. Metadata
 * is redacted defensively before insert.
 *
 * Writes here are best-effort: a failed audit insert is logged but never blocks
 * or reverses the primary action. Use this ONLY for non-critical / supplementary
 * events (logins, denials, the auth.users invitation side-effect, etc.).
 *
 * CRITICAL security mutations (staff provisioning, role changes, activation/
 * deactivation) must NOT rely on this path. Their CANONICAL audit row is written
 * inside the same PL/pgSQL transaction as the mutation by the private.* RPCs
 * (migration 8), so the mutation and its audit record cannot silently diverge.
 *
 * The .server.ts suffix keeps this off the client.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import { safeServerLog, redactPII } from "./security.server";

/** Canonical audit action names. Extend as new sensitive events appear. */
export type AuditAction =
  | "auth.login.success" // privileged login succeeded
  | "auth.login.denied" // privileged login attempt denied (inactive/lookup)
  | "auth.login.failed" // bad credentials on a known privileged email
  | "auth.logout"
  | "auth.password_reset.completed"
  | "auth.password_changed" // authenticated change (current password verified)
  | "auth.password_change.denied" // change refused (e.g. wrong current password)
  | "mfa.enroll.started" // enrollment initiation (no secret/QR in metadata)
  | "mfa.enroll.denied" // enrollment initiation refused (e.g. AAL2 required)
  | "mfa.enroll.failed" // enrollment initiation errored at the provider
  | "mfa.enrolled"
  | "mfa.removed"
  | "mfa.remove.denied" // factor removal refused (e.g. AAL2 required)
  | "mfa.challenge.success"
  | "mfa.challenge.failed"
  | "staff.invited"
  | "staff.provisioned"
  | "staff.activated"
  | "staff.deactivated"
  | "staff.role_changed"
  | "authz.denied" // permission denial for a sensitive action
  | "settings.updated" // canonical settings change (written by api.save_settings, SQL-side)
  | "integration.changed"
  | "owner.action"
  // catalog admin writes (Stage 2)
  | "product.created"
  | "product.updated"
  | "product.status_changed"
  | "product.deleted"
  | "category.created"
  | "category.updated"
  | "category.status_changed"
  | "category.reordered"
  | "category.deleted"
  | "inventory.adjusted"
  | "inventory.bulk_adjusted"
  // order lifecycle (Stage 3) — these are written SQL-side by the api.* RPCs
  // (place_order / transition_order / submit_payment_evidence), not via writeAudit;
  // listed here so the union stays the documented contract for the action column.
  | "order.placed"
  | "order.transition"
  | "payment.evidence_submitted"
  // coupon admin (Stage 3 P5d) — written SQL-side by the api.*_coupon RPCs.
  | "coupon.created"
  | "coupon.updated"
  | "coupon.status_changed"
  | "coupon.deleted"
  // customer accounts (Stage 4) — written SQL-side by api.import_account_data.
  // Routine account self-writes are deliberately NOT audited (plan §2/§8).
  | "account.imported";

export interface AuditEntry {
  action: AuditAction;
  /** The authenticated actor performing the action. null = system task. */
  actorId: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Safe, non-secret context. Redacted again defensively before insert. */
  metadata?: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /(password|token|secret|code|key|authorization|cookie)/i;

/** Strip obviously-secret keys and redact PII from audit metadata. */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string") {
      out[k] = redactPII(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Write an audit record. Best-effort: never throws to the caller.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    const metadata = sanitizeMetadata(entry.metadata);
    if (entry.actorId === null) metadata.system = true;

    const { error } = await admin.from("audit_logs").insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata,
    });

    if (error) {
      safeServerLog("error", "Audit write failed", {
        action: entry.action,
        code: (error as { code?: string }).code ?? "unknown",
      });
    }
  } catch (err) {
    // Audit must never break the primary operation.
    safeServerLog("error", "Audit write threw", {
      action: entry.action,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
