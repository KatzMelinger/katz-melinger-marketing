import { NextResponse } from "next/server";

import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushSeoUrl,
  SEMRUSH_DATABASE,
  SEMRUSH_DOMAIN,
} from "@/lib/semrush";

export const dynamic = "force-dynamic";

/** Semrush report: organic competitors (type domain_organic_organic). */
export async function GET() {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    return NextResponse.json({
      competitors: [],
      error: "Missing SEMRUSH_API_KEY",
    });
  }

  try {
    const url = semrushSeoUrl({
      key,
      type: "domain_organic_organic",
      domain: SEMRUSH_DOMAIN,
      database: SEMRUSH_DATABASE,
      display_limit: "5",
      display_sort: "np_desc",
      export_columns: "Dn,Np",
      export_decode: "1",
    });

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const parsed = parseSemrushCsv(text);
    if (!parsed || parsed.rows.length === 0) {
      return NextResponse.json({ competitors: [] });
    }

    const headers = parsed.headers.map((h) => h.trim());
    const competitors = parsed.rows.map((row) => {
      const r = rowToRecord(headers, row);
      const domain = r["Domain"] ?? r["Dn"] ?? "";
      const common = parseIntSafe(
        r["Common Keywords"] ?? r["Np"] ?? r["Common keywords"]
      );
      return { domain, commonKeywords: common };
    });

    return NextResponse.json({ competitors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ competitors: [], error: message });
  }
}
