import { describe, it, expect } from "vitest";
import { toCsv, CSV_MAX_ROWS } from "@/lib/csv-shared";

describe("toCsv", () => {
  it("builds a BOM-prefixed CRLF CSV with a header row", () => {
    const { csv, truncated } = toCsv(["a", "b"], [["x", 1]]);
    expect(truncated).toBe(false);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("a,b\r\nx,1\r\n");
  });

  it("quotes fields containing commas, quotes and newlines", () => {
    const { csv } = toCsv(["v"], [['he said "hi", twice'], ["line1\nline2"]]);
    expect(csv).toContain('"he said ""hi"", twice"');
    expect(csv).toContain('"line1\nline2"');
  });

  it("renders null/undefined as empty and keeps numbers/booleans raw", () => {
    const { csv } = toCsv(["a", "b", "c", "d"], [[null, undefined, 42, true]]);
    expect(csv.slice(1)).toBe("a,b,c,d\r\n,,42,true\r\n");
  });

  it("neutralizes spreadsheet formula injection", () => {
    const { csv } = toCsv(["v"], [["=SUM(A1)"], ["+1"], ["-1"], ["@cmd"]]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@cmd");
  });

  it("caps output at CSV_MAX_ROWS and reports truncation", () => {
    const rows = Array.from({ length: CSV_MAX_ROWS + 5 }, (_, i) => [i]);
    const { csv, truncated } = toCsv(["n"], rows);
    expect(truncated).toBe(true);
    // header + CSV_MAX_ROWS data lines (each ends with CRLF)
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(CSV_MAX_ROWS + 1);
  });
});
