import { NextResponse } from "next/server";

import { getGoogleAccessToken } from "@/lib/google-access-token";
import { getGscSiteUrl, gscSiteUrlEncoded } from "@/lib/gsc-site-url";

export const dynamic = "force-dynamic";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  return { startDate: ymd(start), endDate: ymd(end) };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") ?? "overview";

  const auth = await getGoogleAccessToken([SCOPE]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 500 });
  }
  const token = auth.token;

  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${gscSiteUrlEncoded()}/searchAnalytics/query`;
  const range = dateRange();

  async function query(body: Record<string, unknown>) {
    const res = await fetch(base, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate: range.startDate, endDate: range.endDate, ...body }),
    });
    const json = (await res.json()) as {
      rows?: unknown[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        message: json.error?.message ?? `GSC ${res.status}`,
      };
    }
    return { ok: true as const, json };
  }

  try {
    if (action === "overview") {
      const [aggRes, dayRes] = await Promise.all([
        query({
          rowLimit: 1,
        }),
        query({
          dimensions: ["date"],
          rowLimit: 40,
        }),
      ]);

      if (!aggRes.ok) {
        return NextResponse.json(
          {
            error: aggRes.message,
            totalClicks: 0,
            totalImpressions: 0,
            avgCtr: 0,
            avgPosition: 0,
            days: [],
          },
          { status: aggRes.status >= 500 ? 502 : 400 },
        );
      }

      const aggRows = (
        aggRes.json as {
          rows?: {
            clicks?: number;
            impressions?: number;
            ctr?: number;
            position?: number;
          }[];
        }
      ).rows ?? [];
      const row0 = aggRows[0];
      const totalClicks = row0?.clicks ?? 0;
      const totalImpressions = row0?.impressions ?? 0;
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : row0?.ctr ?? 0;
      const avgPosition = row0?.position ?? 0;

      let days: { date: string; clicks: number; impressions: number }[] = [];
      let timelineWarning: string | undefined;
      if (dayRes.ok) {
        const dr = (
          dayRes.json as {
            rows?: {
              keys?: string[];
              clicks?: number;
              impressions?: number;
            }[];
          }
        ).rows ?? [];
        days = dr
          .map((r) => ({
            date: r.keys?.[0] ?? "",
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
      } else {
        timelineWarning = dayRes.message;
      }

      return NextResponse.json({
        propertyUrl: getGscSiteUrl(),
        totalClicks,
        totalImpressions,
        avgCtr,
        avgPosition,
        days,
        ...(timelineWarning ? { timelineWarning } : {}),
      });
    }

    if (action === "queries") {
      const res = await query({
        dimensions: ["query"],
        rowLimit: 25,
        orderBy: [{ field: "clicks", sortOrder: "descending" }],
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.message, keywords: [] },
          { status: res.status >= 500 ? 502 : 400 },
        );
      }
      const rows = (
        res.json as {
          rows?: {
            keys?: string[];
            clicks?: number;
            impressions?: number;
            ctr?: number;
            position?: number;
          }[];
        }
      ).rows ?? [];
      const keywords = rows.map((r) => ({
        query: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
      return NextResponse.json({ keywords });
    }

    if (action === "pages") {
      const res = await query({
        dimensions: ["page"],
        rowLimit: 15,
        orderBy: [{ field: "clicks", sortOrder: "descending" }],
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.message, pages: [] },
          { status: res.status >= 500 ? 502 : 400 },
        );
      }
      const rows = (
        res.json as {
          rows?: {
            keys?: string[];
            clicks?: number;
            impressions?: number;
            ctr?: number;
            position?: number;
          }[];
        }
      ).rows ?? [];
      const pages = rows.map((r) => ({
        page: r.keys?.[0] ?? "",
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
      return NextResponse.json({ pages });
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Use overview, queries, or pages.` },
      { status: 400 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search Console request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
