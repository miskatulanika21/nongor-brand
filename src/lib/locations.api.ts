/**
 * Bangladesh location lookup API — public, cached, lazy.
 *
 * Public read: checkout runs pre-auth, so a guest must be able to pick their
 * address. The tables carry public-read RLS and hold nothing sensitive — this
 * is the same reference data printed on every government form.
 *
 * One level per call. The full tree is ~5k rural rows plus ~22k Pathao areas;
 * shipping that to the browser would cost more than the entire storefront
 * bundle. Checkout fetches only the children of what was just selected.
 *
 * Server-only modules are imported INSIDE handler closures so they never enter
 * the client bundle (same pattern as catalog.api.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const id = z.number().int().positive();

export const listDivisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listDivisions } = await import("@/lib/server/locations.server");
  try {
    return { success: true as const, divisions: await listDivisions() };
  } catch (e) {
    const { safeServerLog } = await import("@/lib/server/security.server");
    safeServerLog("error", "listDivisions failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return { success: false as const, divisions: [] };
  }
});

export const listDistrictsFn = createServerFn({ method: "GET" })
  .validator(z.object({ divisionId: id }))
  .handler(async ({ data }) => {
    const { listDistricts } = await import("@/lib/server/locations.server");
    try {
      return { success: true as const, districts: await listDistricts(data.divisionId) };
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "listDistricts failed", {
        divisionId: data.divisionId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, districts: [] };
    }
  });

export const listThanasFn = createServerFn({ method: "GET" })
  .validator(z.object({ districtId: id }))
  .handler(async ({ data }) => {
    const { listThanas } = await import("@/lib/server/locations.server");
    try {
      return { success: true as const, thanas: await listThanas(data.districtId) };
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "listThanas failed", {
        districtId: data.districtId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, thanas: [] };
    }
  });

export const listAreasFn = createServerFn({ method: "GET" })
  .validator(z.object({ thanaId: id }))
  .handler(async ({ data }) => {
    const { listAreas } = await import("@/lib/server/locations.server");
    try {
      return { success: true as const, areas: await listAreas(data.thanaId) };
    } catch (e) {
      const { safeServerLog } = await import("@/lib/server/security.server");
      safeServerLog("error", "listAreas failed", {
        thanaId: data.thanaId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return { success: false as const, areas: [] };
    }
  });
