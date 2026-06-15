import { NextResponse } from "next/server";

import { getGoogleAccessToken } from "@/lib/google-access-token";
import { getTenantConfig } from "@/lib/tenant-config";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error, days: [] });
  }

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent((await getTenantConfig()).gscSiteUrl)}/searchAnalytics/query`;

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
        dimensions: ["date"],
        rowLimit: 40,
      }),
    });
    const json = (await res.json()) as {
      rows?: {
        keys?: string[];
        clicks?: number;
        impressions?: number;
      }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json({
        error: json.error?.message ?? `GSC ${res.status}`,
        days: [],
      });
    }
    const days = (json.rows ?? [])
      .map((r) => ({
        date: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return NextResponse.json({ days });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "GSC failed",
      days: [],
    });
  }
}
