import { NextResponse } from "next/server";

import {
  parseIntSafe,
  parseSemrushCsv,
  rowToRecord,
  semrushSeoUrl,
} from "@/lib/semrush";
import { cachedSemrushFetch } from "@/lib/semrush-cache";
import { guardUser } from "@/lib/supabase-route";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

/** Semrush report: domain organic search keywords (often referred to as phrase_organic in older docs). */
export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;
  const key = process.env.SEMRUSH_API_KEY;
  if (!key) {
    return NextResponse.json({ keywords: [], error: "Missing SEMRUSH_API_KEY" });
  }

  try {
    const { seoDomain, semrushDatabase } = await getTenantConfig();
    const url = semrushSeoUrl({
      key,
      type: "domain_organic",
      domain: seoDomain,
      database: semrushDatabase,
      display_limit: "20",
      display_sort: "tr_desc",
      export_columns: "Ph,Po,Nq,Ur,Tr",
      export_decode: "1",
    });

    const res = await cachedSemrushFetch(url);
    const text = await res.text();
    const parsed = parseSemrushCsv(text);
    if (!parsed || parsed.rows.length === 0) {
      return NextResponse.json({ keywords: [] });
    }

    const headers = parsed.headers.map((h) => h.trim());
    const keywords = parsed.rows.map((row) => {
      const r = rowToRecord(headers, row);
      const keyword = r["Keyword"] ?? r["Ph"] ?? "";
      const posRaw = r["Position"] ?? r["Po"] ?? "";
      const vol = parseIntSafe(r["Search Volume"] ?? r["Nq"]);
      const urlVal = r["Url"] ?? r["Ur"] ?? "";
      let position = parseIntSafe(posRaw);
      if (position === 0 && posRaw && /\d/.test(posRaw)) {
        const m = posRaw.match(/(\d+)/);
        if (m) {
          position = parseIntSafe(m[1]);
        }
      }
      return {
        keyword,
        position,
        searchVolume: vol,
        url: urlVal,
      };
    });

    return NextResponse.json({ keywords });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ keywords: [], error: message });
  }
}
