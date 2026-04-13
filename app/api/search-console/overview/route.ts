import { NextResponse } from "next/server";

import { getGoogleAccessToken } from "@/lib/google-access-token";
import { gscSiteUrlEncoded } from "@/lib/gsc-site-url";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({
      error: auth.error,
      totalClicks: 0,
      totalImpressions: 0,
      avgCtr: 0,
      avgPosition: 0,
    });
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);

  const siteEnc = gscSiteUrlEncoded();
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteEnc}/searchAnalytics/query`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(start),
        endDate: ymd(end),
        dimensions: ["query"],
        rowLimit: 25000,
      }),
    });
    const json = (await res.json()) as {
      rows?: { clicks?: number; impressions?: number; ctr?: number; position?: number }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json({
        error: json.error?.message ?? `GSC ${res.status}`,
        totalClicks: 0,
        totalImpressions: 0,
        avgCtr: 0,
        avgPosition: 0,
      });
    }
    const rows = json.rows ?? [];
    let totalClicks = 0;
    let totalImpressions = 0;
    let posWeighted = 0;
    for (const r of rows) {
      const c = r.clicks ?? 0;
      const im = r.impressions ?? 0;
      totalClicks += c;
      totalImpressions += im;
      posWeighted += (r.position ?? 0) * im;
    }
    const avgCtr =
      totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const avgPosition =
      totalImpressions > 0 ? posWeighted / totalImpressions : 0;
    return NextResponse.json({
      totalClicks,
      totalImpressions,
      avgCtr,
      avgPosition,
    });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "GSC failed",
      totalClicks: 0,
      totalImpressions: 0,
      avgCtr: 0,
      avgPosition: 0,
    });
  }
}
