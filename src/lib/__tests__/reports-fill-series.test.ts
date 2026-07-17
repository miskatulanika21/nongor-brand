import { describe, it, expect } from "vitest";
import { fillDailySeries, presetRange, type SalesByDay } from "@/lib/reports-shared";

const row = (day: string, delivered: number): SalesByDay => ({
  day,
  orders: 1,
  confirmed_revenue: delivered,
  delivered_revenue: delivered,
});

describe("fillDailySeries", () => {
  const range = { from: "2026-07-10", to: "2026-07-17" }; // 7 days, `to` exclusive

  it("returns one row per day across the range", () => {
    expect(fillDailySeries([], range)).toHaveLength(7);
    expect(fillDailySeries([], range).map((d) => d.day)).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
    ]);
  });

  it("fills days with no orders as explicit zeros", () => {
    const out = fillDailySeries([row("2026-07-12", 2470)], range);
    expect(out.find((d) => d.day === "2026-07-11")).toEqual({
      day: "2026-07-11",
      orders: 0,
      confirmed_revenue: 0,
      delivered_revenue: 0,
    });
  });

  it("preserves real rows exactly", () => {
    const real = row("2026-07-12", 2470);
    expect(fillDailySeries([real], range).find((d) => d.day === "2026-07-12")).toEqual(real);
  });

  it("keeps days in chronological order regardless of input order", () => {
    const out = fillDailySeries([row("2026-07-15", 10), row("2026-07-11", 5)], range);
    expect(out.map((d) => d.day)).toEqual([...out.map((d) => d.day)].sort());
  });

  it("ignores rows outside the range", () => {
    const out = fillDailySeries([row("2026-06-01", 999)], range);
    expect(out).toHaveLength(7);
    expect(out.some((d) => d.day === "2026-06-01")).toBe(false);
  });

  it("covers exactly the window presetRange asks for", () => {
    const r = presetRange(7, new Date("2026-07-16T12:00:00Z"));
    const out = fillDailySeries([], r);
    expect(out).toHaveLength(7);
    expect(out[out.length - 1].day).toBe("2026-07-16"); // today included
  });
});
