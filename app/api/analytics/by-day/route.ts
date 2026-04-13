import { NextResponse } from "next/server";

import { ga4PropertyResourceName } from "@/lib/ga4-property-id";
import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export async function GET() {
  const property = ga4PropertyResourceName();
  if (!property) {
    return NextResponse.json({ error: "GA4_PROPERTY_ID missing", days: [] });
  }
  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error, days: [] });
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const body = {
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 40,
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
        days: [],
      });
    }
    const days = (json.rows ?? []).map((row) => ({
      date: row.dimensionValues?.[0]?.value ?? "",
      sessions: Number(row.metricValues?.[0]?.value ?? 0) || 0,
      activeUsers: Number(row.metricValues?.[1]?.value ?? 0) || 0,
    }));
    return NextResponse.json({ days });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : "Request failed",
      days: [],
    });
  }
}
