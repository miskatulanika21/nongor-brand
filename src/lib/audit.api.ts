/**
 * Audit-log admin API — createServerFn handler for the owner-only Audit page.
 *
 * Read-only surface: gated by requirePermission("audit.view"), which is
 * owner-exclusive in the permission registry. The RPC re-checks role='owner' as
 * defense in depth. Server-only modules are imported INSIDE the handler closure
 * so they never enter the client bundle (same pattern as orders.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { auditFilterSchema } from "@/lib/audit-shared";

export const listAuditLogsFn = createServerFn({ method: "GET" })
  .validator(auditFilterSchema)
  .handler(async ({ data }) => {
    const { setNoStore } = await import("@/lib/server/admin-guard.server");
    await setNoStore();
    const { requirePermission } = await import("@/lib/server/rbac.server");
    const authz = await requirePermission("audit.view");
    if (!authz.ok) {
      return { success: false as const, error: "Not authorized.", rows: [], total: 0 };
    }

    const { listAuditLogs } = await import("@/lib/server/audit-read.server");
    try {
      const res = await listAuditLogs({
        actorId: authz.identity.userId,
        action: data.action,
        targetType: data.targetType,
        actorFilter: data.actorId,
        from: data.from,
        to: data.to,
        search: data.search,
        limit: data.limit,
        offset: data.offset,
      });
      return { success: true as const, rows: res.rows, total: res.total };
    } catch {
      return { success: false as const, error: "Could not load audit logs.", rows: [], total: 0 };
    }
  });
