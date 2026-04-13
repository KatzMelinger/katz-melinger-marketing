import { NextResponse } from "next/server";

import { ga4PropertyResourceName } from "@/lib/ga4-property-id";
import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export async function GET() {
  const property = ga4PropertyResourceName();
  if (!property) {
    return NextResponse.json({ error: "GA4_PROPERTY_ID missing", sources: [] });
  }
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error, sources: [] });
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const body = {
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 25,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      rows?: {
        dimensionValues?: { value?: string }[];
        metricValues?: { value?: string }[];
      }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json({
        error: json.error?.message ?? `GA4 ${res.status}`,
        sources: [],
      });
    }
    const sources = (json.rows ?? []).map((row) => ({
      name: row.dimensionValues?.[0]?.value ?? "Unknown",
      sessions: Number(row.metricValues?.[0]?.value ?? 0) || 0,
    }));
    return NextResponse.json({ sources });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Request failed",
      sources: [],
    });
  }
}
