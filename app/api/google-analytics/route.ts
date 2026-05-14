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

async function runReport(
  property: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: json.error?.message ?? `GA4 ${res.status}`,
    };
  }
  return { ok: true, json };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "overview";

  const property = ga4PropertyResourceName();
  if (!property) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_ANALYTICS_PROPERTY_ID (or GA4_PROPERTY_ID) is not set to a numeric property ID",
      },
      { status: 400 },
    );
  }

  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 500 });
  }

  const token = auth.token;

  try {
    if (action === "overview") {
      const [totalsRes, segRes] = await Promise.all([
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          metrics: [
            { name: "sessions" },
            { name: "activeUsers" },
            { name: "newUsers" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "screenPageViews" },
          ],
        }),
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "newVsReturning" }],
          metrics: [{ name: "sessions" }],
          limit: 10,
        }),
      ]);

      if (!totalsRes.ok) {
        return NextResponse.json(
          { error: totalsRes.message },
          { status: totalsRes.status >= 500 ? 502 : 400 },
        );
      }

      const totalsJson = totalsRes.json as {
        rows?: { metricValues?: { value?: string }[] }[];
      };
      const mv = totalsJson.rows?.[0]?.metricValues ?? [];

      let segments: { name: string; sessions: number }[] = [];
      let segmentWarning: string | undefined;
      if (segRes.ok) {
        const segJson = segRes.json as {
          rows?: {
            dimensionValues?: { value?: string }[];
            metricValues?: { value?: string }[];
          }[];
        };
        segments = (segJson.rows ?? []).map((row) => ({
          name: row.dimensionValues?.[0]?.value ?? "Unknown",
          sessions: Number(row.metricValues?.[0]?.value ?? 0) || 0,
        }));
      } else {
        segmentWarning = segRes.message;
      }

      return NextResponse.json({
        sessions: num(mv[0]?.value),
        activeUsers: num(mv[1]?.value),
        newUsers: num(mv[2]?.value),
        bounceRate: num(mv[3]?.value),
        averageSessionDuration: num(mv[4]?.value),
        screenPageViews: num(mv[5]?.value),
        segments,
        ...(segmentWarning ? { segmentWarning } : {}),
      });
    }

    if (action === "traffic") {
      const [daysRes, sourcesRes] = await Promise.all([
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: "date" } }],
          limit: 40,
        }),
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 25,
        }),
      ]);

      const errs: string[] = [];
      let days: {
        date: string;
        sessions: number;
        activeUsers: number;
      }[] = [];
      if (daysRes.ok) {
        const j = daysRes.json as {
          rows?: {
            dimensionValues?: { value?: string }[];
            metricValues?: { value?: string }[];
          }[];
        };
        days = (j.rows ?? []).map((row) => ({
          date: row.dimensionValues?.[0]?.value ?? "",
          sessions: Number(row.metricValues?.[0]?.value ?? 0) || 0,
          activeUsers: Number(row.metricValues?.[1]?.value ?? 0) || 0,
        }));
      } else {
        errs.push(daysRes.message);
      }

      let sources: { name: string; sessions: number }[] = [];
      if (sourcesRes.ok) {
        const j = sourcesRes.json as {
          rows?: {
            dimensionValues?: { value?: string }[];
            metricValues?: { value?: string }[];
          }[];
        };
        sources = (j.rows ?? []).map((row) => ({
          name: row.dimensionValues?.[0]?.value ?? "Unknown",
          sessions: Number(row.metricValues?.[0]?.value ?? 0) || 0,
        }));
      } else {
        errs.push(sourcesRes.message);
      }

      return NextResponse.json({
        days,
        sources,
        ...(errs.length ? { error: errs.join(" · ") } : {}),
      });
    }

    if (action === "pages") {
      const res = await runReport(property, token, {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 20,
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: res.message, pages: [] },
          { status: res.status >= 500 ? 502 : 400 },
        );
      }

      const j = res.json as {
        rows?: {
          dimensionValues?: { value?: string }[];
          metricValues?: { value?: string }[];
        }[];
      };
      const pages = (j.rows ?? []).map((row) => ({
        pagePath: row.dimensionValues?.[0]?.value ?? "",
        screenPageViews: Number(row.metricValues?.[0]?.value ?? 0) || 0,
        averageSessionDuration: Number(row.metricValues?.[1]?.value ?? 0) || 0,
      }));
      return NextResponse.json({ pages });
    }

    if (action === "ai-referrals") {
      // Sessions referred from AI answer engines: ChatGPT, Claude,
      // Perplexity, Gemini/Bard, Copilot, You.com, Phind. GA4 stores the
      // referrer host in sessionSource; we filter inListFilter to keep
      // one query simple and capture variants (chat.openai.com,
      // chatgpt.com, etc.).
      const AI_HOSTS = [
        "chat.openai.com",
        "chatgpt.com",
        "claude.ai",
        "perplexity.ai",
        "www.perplexity.ai",
        "gemini.google.com",
        "bard.google.com",
        "copilot.microsoft.com",
        "you.com",
        "phind.com",
      ];
      const filter = {
        filter: {
          fieldName: "sessionSource",
          inListFilter: { values: AI_HOSTS, caseSensitive: false },
        },
      };

      const [bySourceRes, byPageRes, byDayRes, totalsRes] = await Promise.all([
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionSource" }],
          metrics: [
            { name: "sessions" },
            { name: "activeUsers" },
            { name: "newUsers" },
            { name: "conversions" },
          ],
          dimensionFilter: filter,
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 25,
        }),
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "pagePath" }, { name: "sessionSource" }],
          metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
          dimensionFilter: filter,
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 30,
        }),
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }],
          dimensionFilter: filter,
          orderBys: [{ dimension: { dimensionName: "date" } }],
          limit: 40,
        }),
        runReport(property, token, {
          dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          metrics: [
            { name: "sessions" },
            { name: "activeUsers" },
            { name: "newUsers" },
            { name: "conversions" },
            { name: "engagementRate" },
            { name: "averageSessionDuration" },
          ],
          dimensionFilter: filter,
        }),
      ]);

      const errs: string[] = [];
      type Row = {
        dimensionValues?: { value?: string }[];
        metricValues?: { value?: string }[];
      };

      let bySource: Array<{
        source: string;
        sessions: number;
        activeUsers: number;
        newUsers: number;
        conversions: number;
      }> = [];
      if (bySourceRes.ok) {
        bySource = ((bySourceRes.json as { rows?: Row[] }).rows ?? []).map((r) => ({
          source: r.dimensionValues?.[0]?.value ?? "",
          sessions: num(r.metricValues?.[0]?.value),
          activeUsers: num(r.metricValues?.[1]?.value),
          newUsers: num(r.metricValues?.[2]?.value),
          conversions: num(r.metricValues?.[3]?.value),
        }));
      } else {
        errs.push(bySourceRes.message);
      }

      let byPage: Array<{
        page: string;
        source: string;
        sessions: number;
        pageViews: number;
      }> = [];
      if (byPageRes.ok) {
        byPage = ((byPageRes.json as { rows?: Row[] }).rows ?? []).map((r) => ({
          page: r.dimensionValues?.[0]?.value ?? "",
          source: r.dimensionValues?.[1]?.value ?? "",
          sessions: num(r.metricValues?.[0]?.value),
          pageViews: num(r.metricValues?.[1]?.value),
        }));
      } else {
        errs.push(byPageRes.message);
      }

      let byDay: Array<{ date: string; sessions: number }> = [];
      if (byDayRes.ok) {
        byDay = ((byDayRes.json as { rows?: Row[] }).rows ?? []).map((r) => ({
          date: r.dimensionValues?.[0]?.value ?? "",
          sessions: num(r.metricValues?.[0]?.value),
        }));
      } else {
        errs.push(byDayRes.message);
      }

      let totals = {
        sessions: 0,
        activeUsers: 0,
        newUsers: 0,
        conversions: 0,
        engagementRate: 0,
        averageSessionDuration: 0,
      };
      if (totalsRes.ok) {
        const mv = ((totalsRes.json as { rows?: Row[] }).rows ?? [])[0]?.metricValues ?? [];
        totals = {
          sessions: num(mv[0]?.value),
          activeUsers: num(mv[1]?.value),
          newUsers: num(mv[2]?.value),
          conversions: num(mv[3]?.value),
          engagementRate: num(mv[4]?.value),
          averageSessionDuration: num(mv[5]?.value),
        };
      } else {
        errs.push(totalsRes.message);
      }

      return NextResponse.json({
        totals,
        bySource,
        byPage,
        byDay,
        hosts: AI_HOSTS,
        ...(errs.length ? { error: errs.join(" · ") } : {}),
      });
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Use overview, traffic, pages, or ai-referrals.` },
      { status: 400 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "GA4 request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
