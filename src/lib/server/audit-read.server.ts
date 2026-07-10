/**
 * Audit-log read repository — SERVER ONLY.
 *
 * Wraps the service-role admin client over api.list_audit_logs (REVOKE-d from
 * anon/authenticated). Authorization (owner-only via requirePermission
 * "audit.view") is enforced upstream by audit.api.ts; this layer assumes a
 * verified actor and does the narrow system call + snake→camel mapping.
 *
 * Separate from audit.server.ts on purpose: that module WRITES audit rows;
 * this one READS them for the admin surface.
 */
import { createAdminSupabaseClient } from "./supabase-admin.server";
import type { AuditLogListResult, AuditLogRow, JsonObject } from "@/lib/audit-shared";

export class AuditReadError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AuditReadError";
  }
}

interface RawAuditRow {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: JsonObject | null;
  created_at: string;
}

function mapRow(r: RawAuditRow): AuditLogRow {
  return {
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}

export interface ListAuditLogsArgs {
  actorId: string;
  action?: string;
  targetType?: string;
  actorFilter?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(args: ListAuditLogsArgs): Promise<AuditLogListResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.schema("api").rpc("list_audit_logs", {
    p_actor: args.actorId,
    p_action: args.action ?? null,
    p_target_type: args.targetType ?? null,
    p_actor_filter: args.actorFilter ?? null,
    p_from: args.from ?? null,
    p_to: args.to ?? null,
    p_search: args.search ?? null,
    p_limit: args.limit ?? 50,
    p_offset: args.offset ?? 0,
  });
  if (error) {
    // The only stable code this RPC raises is actor_not_authorized; anything
    // else collapses to internal_error so raw SQL never reaches the client.
    const raw = (error.message ?? "").trim();
    throw new AuditReadError(raw === "actor_not_authorized" ? raw : "internal_error");
  }
  const raw = (data ?? { rows: [], total: 0 }) as { rows: RawAuditRow[] | null; total: number };
  return {
    rows: (raw.rows ?? []).map(mapRow),
    total: raw.total ?? 0,
  };
}
