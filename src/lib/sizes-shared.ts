/**
 * Size charts — isomorphic types, input schema & error copy (Stage 6 P5).
 * NO server-only imports (safe in the client bundle). Mirrors the
 * api.*size_chart* RPCs and the `size_charts` table (columns = ordered
 * measurement names; rows = {label, values[], popular} aligned to columns).
 */
import { z } from "zod";

export interface SizeChartRow {
  label: string;
  values: string[];
  popular: boolean;
}

/** Public storefront payload (api.get_size_charts — active charts only). */
export interface PublicSizeChart {
  id: string;
  slug: string;
  name: string;
  unit: "in" | "cm";
  label_header: string;
  helper_column: string | null;
  note: string | null;
  columns: string[];
  rows: SizeChartRow[];
}

/** Full admin row (api.list_size_charts / upsert_size_chart). */
export interface AdminSizeChart extends PublicSizeChart {
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Input validation (mirrors the RPC's deep validation; server re-checks) ───

const cell = z.string().trim().max(20);

export const sizeChartRowSchema = z.object({
  label: z.string().trim().min(1, "Every row needs a label.").max(40),
  values: z.array(cell),
  popular: z.boolean().default(false),
});

export const sizeChartInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "A slug is required.")
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, numbers and dashes only."),
    name: z.string().trim().min(1, "A chart name is required.").max(80),
    unit: z.enum(["in", "cm"]).default("in"),
    label_header: z.string().trim().min(1).max(40).default("Size"),
    helper_column: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(40).nullable(),
      )
      .nullable()
      .optional(),
    note: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z.string().trim().max(300).nullable(),
      )
      .nullable()
      .optional(),
    columns: z
      .array(z.string().trim().min(1, "Column names can't be empty.").max(40))
      .min(1, "Add at least one measurement column.")
      .max(12, "At most 12 measurement columns."),
    rows: z.array(sizeChartRowSchema).max(30, "At most 30 rows."),
    sort_order: z.coerce.number().int().min(0).max(1000).default(0),
    is_active: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    c.rows.forEach((row, i) => {
      if (row.values.length !== c.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", i],
          message: `Row "${row.label}" must have exactly ${c.columns.length} values.`,
        });
      }
    });
    if (c.helper_column && !c.columns.includes(c.helper_column)) {
      ctx.addIssue({
        code: "custom",
        path: ["helper_column"],
        message: "Must be one of the chart's columns.",
      });
    }
  });

export type SizeChartInput = z.infer<typeof sizeChartInputSchema>;

export const setSizeChartActiveSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export const sizeChartIdArgSchema = z.object({ id: z.string().uuid() });

// ── Error copy (stable snake_case codes from the RPCs) ───────────────────────

export const SIZE_CHART_ERROR_MESSAGES: Record<string, string> = {
  actor_not_authorized: "Not authorized.",
  size_chart_not_found: "That size chart no longer exists.",
  invalid_size_chart:
    "The chart is invalid — check that every row has a value for every column and the slug is unique.",
  internal_error: "Could not save the size chart. Please try again.",
};

export const KNOWN_SIZE_CHART_ERROR_CODES = new Set(Object.keys(SIZE_CHART_ERROR_MESSAGES));

export function sizeChartErrorMessage(code: string | null | undefined): string {
  if (!code) return SIZE_CHART_ERROR_MESSAGES.internal_error;
  return SIZE_CHART_ERROR_MESSAGES[code] ?? SIZE_CHART_ERROR_MESSAGES.internal_error;
}

// ── Mapping to the size-guide's table shape (cols/rows arrays) ───────────────

/** The legacy shape ChartTable + the starting-point helper consume. */
export interface GuideChart {
  cols: string[];
  rows: string[][];
}

/**
 * Map a chart to the size-guide table shape: cols = [label_header, ...columns];
 * each row = [label, ...values, "popular"?] (the trailing marker matches the
 * legacy hardcoded arrays so the existing renderer works unchanged).
 */
export function toGuideChart(chart: PublicSizeChart): GuideChart {
  return {
    cols: [chart.label_header, ...chart.columns],
    rows: chart.rows.map((r) =>
      r.popular ? [r.label, ...r.values, "popular"] : [r.label, ...r.values],
    ),
  };
}

/** Coerce the api.get_size_charts payload (drops malformed entries). */
export function toPublicSizeCharts(raw: unknown): PublicSizeChart[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicSizeChart[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      typeof c.slug !== "string" ||
      typeof c.name !== "string" ||
      !Array.isArray(c.columns) ||
      !Array.isArray(c.rows)
    ) {
      continue;
    }
    out.push({
      id: c.id,
      slug: c.slug,
      name: c.name,
      unit: c.unit === "cm" ? "cm" : "in",
      label_header: typeof c.label_header === "string" ? c.label_header : "Size",
      helper_column: typeof c.helper_column === "string" ? c.helper_column : null,
      note: typeof c.note === "string" ? c.note : null,
      columns: c.columns.filter((x): x is string => typeof x === "string"),
      rows: (c.rows as unknown[])
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
        .map((r) => ({
          label: typeof r.label === "string" ? r.label : "",
          values: Array.isArray(r.values)
            ? r.values.filter((v): v is string => typeof v === "string")
            : [],
          popular: r.popular === true,
        }))
        .filter((r) => r.label !== ""),
    });
  }
  return out;
}
