import { describe, it, expect } from "vitest";
import {
  FOUNDER_FALLBACK,
  FOUNDER_ICON_KEYS,
  founderContentSchema,
  founderErrorMessage,
  founderRevisionArgSchema,
  isFounderIconKey,
  toFounderContent,
} from "@/lib/founder-shared";
import { ROLE_PERMISSIONS, OWNER_ONLY_PERMISSIONS, roleHasPermission } from "@/lib/permissions";
import { ADMIN_NAV_ITEMS, requiredPermissionForAdminPath } from "@/lib/admin-routes";
import { isKnownAuditAction, auditActionLabel } from "@/lib/audit-shared";

/** Deep clone so a mutation in one case never leaks into the next. */
const base = () => JSON.parse(JSON.stringify(FOUNDER_FALLBACK)) as typeof FOUNDER_FALLBACK;

describe("founderContentSchema", () => {
  it("accepts the shipped fallback document", () => {
    expect(founderContentSchema.safeParse(FOUNDER_FALLBACK).success).toBe(true);
  });

  it("requires the identity fields and bounds their lengths", () => {
    expect(founderContentSchema.safeParse({ ...base(), name: " " }).success).toBe(false);
    expect(founderContentSchema.safeParse({ ...base(), name: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(founderContentSchema.safeParse({ ...base(), eyebrow: "x".repeat(81) }).success).toBe(
      false,
    );
  });

  it("caps every list so the designed layout cannot be overflowed", () => {
    const tooManyStats = base();
    tooManyStats.hero.stats = Array.from({ length: 5 }, () => ({ label: "L", value: "V" }));
    expect(founderContentSchema.safeParse(tooManyStats).success).toBe(false);

    const tooManyChapters = base();
    tooManyChapters.journey.items = Array.from({ length: 9 }, () => ({
      icon: "anchor" as const,
      chapter: "C",
      title: "T",
      body: "B",
    }));
    expect(founderContentSchema.safeParse(tooManyChapters).success).toBe(false);

    const tooManyDetails = base();
    tooManyDetails.craft.details = Array.from({ length: 11 }, (_, i) => `detail ${i}`);
    expect(founderContentSchema.safeParse(tooManyDetails).success).toBe(false);
  });

  it("requires at least one letter paragraph", () => {
    const empty = base();
    empty.letter.paragraphs = [];
    expect(founderContentSchema.safeParse(empty).success).toBe(false);
  });

  it("rejects icon keys outside the closed registry", () => {
    const bad = base();
    // A free-text icon would render nothing on the page, so the enum must hold.
    (bad.philosophy.items[0] as { icon: string }).icon = "rocket";
    expect(founderContentSchema.safeParse(bad).success).toBe(false);
    expect(isFounderIconKey("rocket")).toBe(false);
    for (const key of FOUNDER_ICON_KEYS) expect(isFounderIconKey(key)).toBe(true);
  });

  it("normalizes an empty image URL to null (→ built-in asset)", () => {
    const blank = base();
    blank.hero.portraitUrl = "   ";
    const parsed = founderContentSchema.parse(blank);
    expect(parsed.hero.portraitUrl).toBeNull();
  });
});

describe("toFounderContent", () => {
  it("returns null for payloads that do not satisfy the schema", () => {
    expect(toFounderContent(null)).toBeNull();
    expect(toFounderContent({})).toBeNull();
    expect(toFounderContent({ ...base(), quote: undefined })).toBeNull();
  });

  it("parses a valid document", () => {
    expect(toFounderContent(FOUNDER_FALLBACK)?.name).toBe(FOUNDER_FALLBACK.name);
  });
});

describe("founderRevisionArgSchema", () => {
  it("coerces positive integer ids only", () => {
    expect(founderRevisionArgSchema.parse({ revisionId: "7" }).revisionId).toBe(7);
    expect(founderRevisionArgSchema.safeParse({ revisionId: 0 }).success).toBe(false);
    expect(founderRevisionArgSchema.safeParse({ revisionId: -3 }).success).toBe(false);
  });
});

describe("founderErrorMessage", () => {
  it("maps known codes and degrades unknown ones", () => {
    expect(founderErrorMessage("no_draft_to_publish")).toMatch(/no draft/i);
    expect(founderErrorMessage("actor_not_authorized")).toMatch(/not authorized/i);
    expect(founderErrorMessage("mystery_code")).toBe(founderErrorMessage("internal_error"));
  });
});

describe("founder.manage is owner-exclusive", () => {
  it("is granted to the owner and withheld from admin and staff", () => {
    expect(roleHasPermission("owner", "founder.manage")).toBe(true);
    expect(roleHasPermission("admin", "founder.manage")).toBe(false);
    expect(roleHasPermission("staff", "founder.manage")).toBe(false);
    expect(ROLE_PERMISSIONS.owner.has("founder.manage")).toBe(true);
    expect(OWNER_ONLY_PERMISSIONS).toContain("founder.manage");
  });

  it("guards the /admin/founder route and hides its nav link from non-owners", () => {
    expect(requiredPermissionForAdminPath("/admin/founder")).toBe("founder.manage");
    const item = ADMIN_NAV_ITEMS.find((i) => i.to === "/admin/founder");
    expect(item?.permission).toBe("founder.manage");
    // Nav visibility mirrors the guard, so an admin never sees the link.
    expect(roleHasPermission("admin", item!.permission)).toBe(false);
  });
});

describe("founder audit actions", () => {
  it("are registered so the audit trail labels them", () => {
    for (const action of ["founder.draft_saved", "founder.published", "founder.draft_discarded"]) {
      expect(isKnownAuditAction(action)).toBe(true);
      expect(auditActionLabel(action)).toMatch(/founder/i);
    }
  });
});
