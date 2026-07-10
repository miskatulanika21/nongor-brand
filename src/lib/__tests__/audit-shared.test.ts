import { describe, it, expect } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_META,
  AUDIT_CATEGORIES,
  auditActionLabel,
  auditActionTone,
  auditActionCategory,
  auditActorDisplay,
  actionsForCategory,
  isKnownAuditAction,
  auditFilterSchema,
  type AuditLogRow,
} from "@/lib/audit-shared";

const baseRow: AuditLogRow = {
  id: 1,
  actorId: "11111111-1111-1111-1111-111111111111",
  actorEmail: "owner@nongorr.test",
  actorName: "Owner",
  actorRole: "owner",
  action: "product.created",
  targetType: "product",
  targetId: "PRD-1",
  metadata: {},
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("audit action taxonomy", () => {
  it("every action has display meta with a valid category (compile + runtime parity)", () => {
    for (const action of AUDIT_ACTIONS) {
      const meta = AUDIT_ACTION_META[action];
      expect(meta, action).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(AUDIT_CATEGORIES).toContain(meta.category);
    }
  });

  it("has no duplicate action strings", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("actionsForCategory partitions the taxonomy (every action covered once)", () => {
    const collected = AUDIT_CATEGORIES.flatMap((c) => actionsForCategory(c));
    expect(collected.sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
});

describe("auditActionLabel / tone / category", () => {
  it("returns the catalog label for known actions", () => {
    expect(auditActionLabel("shipment.booked")).toBe("Courier booked");
    expect(auditActionTone("auth.login.failed")).toBe("danger");
    expect(auditActionCategory("coupon.created")).toBe("coupons");
  });

  it("title-cases unknown/future actions instead of throwing", () => {
    expect(auditActionLabel("future.new_event")).toBe("Future New Event");
    expect(auditActionTone("future.new_event")).toBe("neutral");
    expect(auditActionCategory("future.new_event")).toBeNull();
    expect(isKnownAuditAction("future.new_event")).toBe(false);
  });
});

describe("auditActorDisplay", () => {
  it("prefers name, then email, then short id", () => {
    expect(auditActorDisplay(baseRow)).toBe("Owner");
    expect(auditActorDisplay({ ...baseRow, actorName: null })).toBe("owner@nongorr.test");
    expect(auditActorDisplay({ ...baseRow, actorName: null, actorEmail: null })).toBe("11111111…");
  });

  it("shows System for a null actor", () => {
    expect(auditActorDisplay({ ...baseRow, actorId: null })).toBe("System");
  });
});

describe("auditFilterSchema", () => {
  it("accepts a well-formed filter", () => {
    const parsed = auditFilterSchema.parse({
      action: "order.transition",
      search: "  NGR-1 ",
      actorId: "11111111-1111-1111-1111-111111111111",
      from: "2026-07-01T00:00:00.000Z",
      limit: 25,
      offset: 0,
    });
    expect(parsed.search).toBe("NGR-1"); // trimmed
    expect(parsed.limit).toBe(25);
  });

  it("rejects a non-uuid actorId and an over-cap limit", () => {
    expect(() => auditFilterSchema.parse({ actorId: "nope" })).toThrow();
    expect(() => auditFilterSchema.parse({ limit: 500 })).toThrow();
    expect(() => auditFilterSchema.parse({ offset: -1 })).toThrow();
  });
});
