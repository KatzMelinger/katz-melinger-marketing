/**
 * Minimal, dependency-free CSV parser.
 *
 * The project ships no CSV library, and the one place we need to read CSV is
 * SEMrush keyword exports (Keyword Gap / Organic Research / Position Tracking).
 * Those are well-formed RFC-4180-ish files, but SEMrush varies the delimiter by
 * locale (comma in the US, semicolon in much of the EU) and quotes any field
 * containing the delimiter. This parser handles:
 *   - comma, semicolon, or tab delimiters (auto-detected from the header row)
 *   - double-quoted fields with embedded delimiters, quotes ("" escaping),
 *     and newlines
 *   - a UTF-8 BOM prefix
 *   - CRLF or LF line endings
 *
 * It is intentionally small; it is not a general-purpose CSV engine.
 */

export type CsvTable = {
  /** Lower-cased, trimmed header names, in column order. */
  headers: string[];
  /** One object per data row, keyed by header name. */
  rows: Record<string, string>[];
};

const DELIMITERS = [",", ";", "\t"] as const;

/** Pick the delimiter that yields the most columns on the header line. */
function detectDelimiter(firstLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    // Count only unquoted delimiters on the header line.
    const count = splitRow(firstLine, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Split a single CSV line into fields, honoring double-quoted sections. */
function splitRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Split raw text into logical records, keeping newlines that fall inside
 * quoted fields attached to their record.
 */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Track quote state so newlines inside quotes don't end a record.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      records.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0) records.push(current);
  return records;
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^﻿/, ""); // strip BOM
  const records = splitRecords(text).filter((r) => r.trim().length > 0);
  if (records.length === 0) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(records[0]);
  const headers = splitRow(records[0], delimiter).map((h) => h.trim().toLowerCase());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = splitRow(records[i], delimiter);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Find the value for the first header that matches any of the candidate names
 * (already lower-cased). Returns "" when no candidate column is present.
 */
export function pickColumn(
  row: Record<string, string>,
  candidates: string[],
): string {
  for (const name of candidates) {
    if (name in row && row[name] !== "") return row[name];
  }
  return "";
}

/** Parse a possibly-formatted number ("1,300", "2.5", "") → number | null. */
export function parseNumber(v: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
