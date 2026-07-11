import { describe, it, expect } from "vitest";
import {
  sizeChartInputSchema,
  sizeChartErrorMessage,
  toGuideChart,
  toPublicSizeCharts,
  type PublicSizeChart,
} from "@/lib/sizes-shared";

const base = {
  slug: "kurti",
  name: "Kurti",
  columns: ["Bust", "Waist"],
  rows: [{ label: "S", values: ["34", "30"], popular: false }],
};

describe("sizeChartInputSchema", () => {
  it("accepts a valid chart and applies defaults", () => {
    const parsed = sizeChartInputSchema.parse(base);
    expect(parsed.unit).toBe("in");
    expect(parsed.label_header).toBe("Size");
    expect(parsed.is_active).toBe(false);
  });

  it("rejects ragged rows (values must match columns)", () => {
    const bad = sizeChartInputSchema.safeParse({
      ...base,
      rows: [{ label: "S", values: ["34"], popular: false }],
    });
    expect(bad.success).toBe(false);
  });

  it("rejects a helper column that is not one of the columns", () => {
    expect(sizeChartInputSchema.safeParse({ ...base, helper_column: "Hip" }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ ...base, helper_column: "Bust" }).success).toBe(true);
    // empty string normalizes to null
    const parsed = sizeChartInputSchema.parse({ ...base, helper_column: "" });
    expect(parsed.helper_column).toBeNull();
  });

  it("enforces slug shape and column bounds", () => {
    expect(sizeChartInputSchema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ ...base, columns: [] }).success).toBe(false);
    expect(sizeChartInputSchema.safeParse({ ...base, columns: Array(13).fill("C") }).success).toBe(
      false,
    );
  });
});

describe("toGuideChart", () => {
  const chart: PublicSizeChart = {
    id: "x",
    slug: "kurti",
    name: "Kurti",
    unit: "in",
    label_header: "Size",
    helper_column: "Bust",
    note: null,
    columns: ["Bust", "Waist"],
    rows: [
      { label: "S", values: ["34", "30"], popular: false },
      { label: "M", values: ["36", "32"], popular: true },
    ],
  };

  it("maps to the legacy cols/rows shape incl. the popular marker", () => {
    const g = toGuideChart(chart);
    expect(g.cols).toEqual(["Size", "Bust", "Waist"]);
    expect(g.rows[0]).toEqual(["S", "34", "30"]);
    expect(g.rows[1]).toEqual(["M", "36", "32", "popular"]);
  });
});

describe("toPublicSizeCharts", () => {
  it("coerces valid entries and drops malformed ones", () => {
    const out = toPublicSizeCharts([
      {
        id: "a",
        slug: "kurti",
        name: "Kurti",
        unit: "cm",
        label_header: "Size",
        helper_column: null,
        note: null,
        columns: ["Bust"],
        rows: [{ label: "S", values: ["86"], popular: false }],
      },
      { junk: true },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].unit).toBe("cm");
    expect(out[0].rows[0].values).toEqual(["86"]);
  });

  it("returns [] for non-array payloads", () => {
    expect(toPublicSizeCharts({})).toEqual([]);
  });
});

describe("sizeChartErrorMessage", () => {
  it("maps known codes and degrades unknown ones", () => {
    expect(sizeChartErrorMessage("invalid_size_chart")).toMatch(/every column/i);
    expect(sizeChartErrorMessage("nope")).toBe(sizeChartErrorMessage("internal_error"));
  });
});
