import { NextResponse } from "next/server";

import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushAnalyticsUrl,
  semrushSeoUrl,
  SEMRUSH_DATABASE,
  SEMRUSH_DOMAIN,
} from "@/lib/semrush";

export const dynamic = "force-dynamic";

/**
 * Organic metrics from `type=domain_ranks` on https://api.semrush.com.
 * Authority Score and backlink total come from Backlinks Overview (same host, `/analytics/v1/`),
 * because `domain_ranks` does not include those fields.
 */
export async function GET() {
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    return NextResponse.json({
      authorityScore: 0,
      organicKeywords: 0,
      organicTraffic: 0,
      backlinks: 0,
      error: "Missing SEMRUSH_API_KEY",
    });
  }

  try {
    const ranksUrl = semrushSeoUrl({
      key,
      type: "domain_ranks",
      domain: SEMRUSH_DOMAIN,
      database: SEMRUSH_DATABASE,
      export_columns: "Dn,Rk,Or,Ot",
      export_decode: "1",
    });

    const backlinksUrl = semrushAnalyticsUrl({
      key,
      type: "backlinks_overview",
      target: SEMRUSH_DOMAIN,
      target_type: "root_domain",
      export_columns: "ascore,total",
      export_decode: "1",
    });

    const [ranksRes, blRes] = await Promise.all([
      fetch(ranksUrl, { cache: "no-store" }),
      fetch(backlinksUrl, { cache: "no-store" }),
    ]);

    let organicKeywords = 0;
    let organicTraffic = 0;
    let authorityScore = 0;
    let backlinks = 0;

    const ranksText = await ranksRes.text();
    const ranksParsed = parseSemrushCsv(ranksText);
    if (ranksParsed && ranksParsed.rows.length > 0) {
      const headers = ranksParsed.headers.map((h) => h.trim());
      const first = rowToRecord(headers, ranksParsed.rows[0]!);
      organicKeywords = parseIntSafe(first["Organic Keywords"] ?? first["Or"]);
      organicTraffic = parseIntSafe(first["Organic Traffic"] ?? first["Ot"]);
    }

    const blText = await blRes.text();
    const blParsed = parseSemrushCsv(blText);
    if (blParsed && blParsed.rows.length > 0) {
      const headers = blParsed.headers.map((h) => h.trim());
      const row = rowToRecord(headers, blParsed.rows[0]!);
      authorityScore = parseIntSafe(row["ascore"] ?? row["Ascore"]);
      backlinks = parseIntSafe(row["total"] ?? row["Total"]);
    }

    return NextResponse.json({
      authorityScore,
      organicKeywords,
      organicTraffic,
      backlinks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({
      authorityScore: 0,
      organicKeywords: 0,
      organicTraffic: 0,
      backlinks: 0,
      error: message,
    });
  }
}
