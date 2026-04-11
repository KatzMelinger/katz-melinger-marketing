export const SEMRUSH_DOMAIN = "katzmelinger.com";
export const SEMRUSH_DATABASE = "us";

const SEO_BASE = "https://api.semrush.com/";
const ANALYTICS_BASE = "https://api.semrush.com/analytics/v1/";

export function semrushSeoUrl(params: Record<string, string>): string {
  const u = new URL(SEO_BASE);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

export function semrushAnalyticsUrl(params: Record<string, string>): string {
  const u = new URL(ANALYTICS_BASE);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

/** Semrush returns semicolon-separated CSV; first line is headers. */
export function parseSemrushCsv(text: string): {
  headers: string[];
  rows: string[][];
} | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("ERROR")) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) {
    return null;
  }
  const headers = lines[0]!.split(";").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(";").map((c) => c.trim()));
  return { headers, rows };
}

export function rowToRecord(
  headers: string[],
  row: string[]
): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = row[i] ?? "";
  });
  return o;
}

export function parseIntSafe(v: string | undefined): number {
  if (v == null || v === "") {
    return 0;
  }
  const n = Number.parseInt(v.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}
