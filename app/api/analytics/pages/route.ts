import { NextResponse } from "next/server";

import { ga4PropertyResourceName } from "@/lib/ga4-property-id";
import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export async function GET() {
  const property = ga4PropertyResourceName();
  if (!property) {
    return NextResponse.json({ error: "GA4_PROPERTY_ID missing", pages: [] });
  }
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error, pages: [] });
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const body = {
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "averageSessionDuration" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: 20,
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
        pages: [],
      });
    }
    const pages = (json.rows ?? []).map((row) => ({
      pagePath: row.dimensionValues?.[0]?.value ?? "",
      screenPageViews: Number(row.metricValues?.[0]?.value ?? 0) || 0,
      averageSessionDuration: Number(row.metricValues?.[1]?.value ?? 0) || 0,
    }));
    return NextResponse.json({ pages });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Request failed",
      pages: [],
    });
  }
}
