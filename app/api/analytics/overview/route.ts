import { NextResponse } from "next/server";

import { ga4PropertyResourceName } from "@/lib/ga4-property-id";
import { getGoogleAccessToken } from "@/lib/google-access-token";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

function num(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  const property = ga4PropertyResourceName();
  if (!property) {
    return NextResponse.json(
      {
        error: "GA4_PROPERTY_ID is not set",
        sessions: 0,
        activeUsers: 0,
        newUsers: 0,
        bounceRate: 0,
        averageSessionDuration: 0,
        screenPageViews: 0,
      },
      { status: 200 },
    );
  }

  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json(
      {
        error: auth.error,
        sessions: 0,
        activeUsers: 0,
        newUsers: 0,
        bounceRate: 0,
        averageSessionDuration: 0,
        screenPageViews: 0,
      },
      { status: 200 },
    );
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const body = {
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "bounceRate" },
      { name: "averageSessionDuration" },
      { name: "screenPageViews" },
    ],
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
      rows?: { metricValues?: { value?: string }[] }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json(
        {
          error: json.error?.message ?? `GA4 ${res.status}`,
          sessions: 0,
          activeUsers: 0,
          newUsers: 0,
          bounceRate: 0,
          averageSessionDuration: 0,
          screenPageViews: 0,
        },
        { status: 200 },
      );
    }
    const mv = json.rows?.[0]?.metricValues ?? [];
    return NextResponse.json({
      sessions: num(mv[0]?.value),
      activeUsers: num(mv[1]?.value),
      newUsers: num(mv[2]?.value),
      bounceRate: num(mv[3]?.value),
      averageSessionDuration: num(mv[4]?.value),
      screenPageViews: num(mv[5]?.value),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "GA4 request failed";
    return NextResponse.json(
      {
        error: message,
        sessions: 0,
        activeUsers: 0,
        newUsers: 0,
        bounceRate: 0,
        averageSessionDuration: 0,
        screenPageViews: 0,
      },
      { status: 200 },
    );
  }
}
