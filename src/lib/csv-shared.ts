/**
 * CSV building — isomorphic, dependency-free (Stage 6 P6). Used by the report
 * server fns to build export payloads; the admin UI downloads them as Blobs.
 *
 * RFC-4180-style quoting: any field containing a comma, quote, CR or LF is
 * wrapped in double quotes with inner quotes doubled. Output starts with a
 * UTF-8 BOM so Excel opens Bangla text and the ৳ sign correctly. Formula
 * injection is neutralized by prefixing =+-@ leaders with a single quote.
 */

export const CSV_MAX_ROWS = 50000;

export type CsvValue = string | number | boolean | null | undefined;

function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  // Spreadsheet formula-injection guard (CSV is opened in Excel/Sheets).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV string from a header row + data rows. Rows beyond CSV_MAX_ROWS
 * are dropped (the caller should surface `truncated` to the user).
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): { csv: string; truncated: boolean } {
  const truncated = rows.length > CSV_MAX_ROWS;
  const kept = truncated ? rows.slice(0, CSV_MAX_ROWS) : rows;
  const lines = [headers.map(csvField).join(",")];
  for (const row of kept) lines.push(row.map(csvField).join(","));
  // U+FEFF = UTF-8 BOM so Excel detects the encoding.
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", truncated };
}

/** Trigger a browser download of a CSV string (client-side only). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
