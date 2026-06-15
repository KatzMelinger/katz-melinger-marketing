import { NextResponse } from "next/server";

import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushAnalyticsUrl,
} from "@/lib/semrush";
import { cachedSemrushFetch } from "@/lib/semrush-cache";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
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
    const { seoDomain } = await getTenantConfig();
    const url = semrushAnalyticsUrl({
      key,
      type: "backlinks_overview",
      target: seoDomain,
      target_type: "root_domain",
      export_columns: "ascore,total,domains_num",
      export_decode: "1",
    });

    const res = await cachedSemrushFetch(url);
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
