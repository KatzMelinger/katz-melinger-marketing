import { NextResponse } from "next/server";

import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushAnalyticsUrl,
  SEMRUSH_DOMAIN,
} from "@/lib/semrush";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    return NextResponse.json({
      authorityScore: 0,
      totalBacklinks: 0,
      referringDomains: 0,
      error: "Missing SEMRUSH_API_KEY",
    });
  }

  try {
    const url = semrushAnalyticsUrl({
      key,
      type: "backlinks_overview",
      target: SEMRUSH_DOMAIN,
      target_type: "root_domain",
      export_columns: "ascore,total,domains_num",
      export_decode: "1",
    });

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const parsed = parseSemrushCsv(text);
    if (!parsed || parsed.rows.length === 0) {
      return NextResponse.json({
      authorityScore: 0,
      totalBacklinks: 0,
      referringDomains: 0,
    });
    }

    const headers = parsed.headers.map((h) => h.trim());
    const row = rowToRecord(headers, parsed.rows[0]!);
    const authorityScore = parseIntSafe(row["ascore"] ?? row["Ascore"]);
    const totalBacklinks = parseIntSafe(row["total"] ?? row["Total"]);
    const referringDomains = parseIntSafe(
      row["domains_num"] ?? row["Domains_num"] ?? row["Referring domains"]
    );

    return NextResponse.json({
      authorityScore,
      totalBacklinks,
      referringDomains,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      authorityScore: 0,
      totalBacklinks: 0,
      referringDomains: 0,
      error: message,
    });
  }
}
