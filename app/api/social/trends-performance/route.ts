/**
 * GET/POST /api/social/trends-performance  — Screen 3 (Trends & Performance)
 *
 * GET returns two things merged:
 *   - AUTO (from Metricool): best-performing formats, top posts, content-type
 *     breakdown — derived from getSocialOverview.
 *   - MANUAL (from social_insights, editable in the UI): audience demographics
 *     (age groups / top cities), Hot/Warm/Growing topics, and the monthly
 *     content suggestion — the parts Metricool's API doesn't expose.
 *
 * POST upserts the manual fields for the tenant.
 */

import { NextResponse } from "next/server";

import { getSocialOverview } from "@/lib/metricool";
import { guardUser } from "@/lib/supabase-route";
import { getTenantDb } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OverviewPost = {
  content?: string;
  publishedAt?: string;
  engagement?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  reach?: number;
  impressions?: number;
  url?: string | null;
  type?: string;
};
type OverviewNetwork = { network: string; key: string; posts: OverviewPost[] };

const FORMAT_LABEL: Record<string, string> = {
  FEED_IMAGE: "Image",
  FEED_VIDEO: "Video",
  REELS: "Reel",
  CAROUSEL: "Carousel",
  CAROUSEL_ALBUM: "Carousel",
  STORY: "Story",
  TEXT: "Text",
  ARTICLE: "Article",
  VIDEO: "Video",
  IMAGE: "Image",
  SHARE: "Share",
};
function fmtLabel(t?: string): string {
  if (!t) return "Other";
  return FORMAT_LABEL[t] ?? t.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
function engagementOf(p: OverviewPost): number {
  const e = Number(p.engagement);
  if (Number.isFinite(e) && e > 0) return e;
  return (Number(p.likes) || 0) + (Number(p.comments) || 0) + (Number(p.shares) || 0);
}

const REPORT_LINKS = [
  { network: "Facebook", url: "https://business.facebook.com/latest/insights/overview" },
  { network: "Instagram", url: "https://www.instagram.com/accounts/professional_dashboard/" },
  { network: "LinkedIn", url: "https://www.linkedin.com/company/" },
  { network: "TikTok", url: "https://www.tiktok.com/tiktokstudio/analytics" },
];

const EMPTY_MANUAL = {
  audience: { ageGroups: [] as Array<{ label: string; pct: number }>, topCities: [] as Array<{ name: string; pct: number }> },
  topics: [] as Array<{ topic: string; status: string }>,
  suggestion: "",
};

async function readManual() {
  try {
    const db = await getTenantDb();
    const { data } = await db
      .from("social_insights")
      .select("audience, topics, suggestion")
      .maybeSingle();
    if (!data) return EMPTY_MANUAL;
    return {
      audience: (data.audience as typeof EMPTY_MANUAL.audience) ?? EMPTY_MANUAL.audience,
      topics: (data.topics as typeof EMPTY_MANUAL.topics) ?? [],
      suggestion: typeof data.suggestion === "string" ? data.suggestion : "",
    };
  } catch {
    return EMPTY_MANUAL;
  }
}

export async function GET() {
  const denied = await guardUser();
  if (denied) return denied;

  const manual = await readManual();

  let topPosts: Array<{ network: string; content: string; engagement: number; reach: number; url: string | null; publishedAt: string | null }> = [];
  let bestFormats: Array<{ format: string; avgEngagement: number; count: number }> = [];
  let contentBreakdown: Array<{ format: string; count: number }> = [];
  let autoError: string | null = null;

  try {
    const data = (await getSocialOverview()) as OverviewNetwork[];
    const allPosts = data.flatMap((n) => n.posts.map((p) => ({ ...p, network: n.network })));

    topPosts = [...allPosts]
      .sort((a, b) => engagementOf(b) - engagementOf(a))
      .slice(0, 6)
      .map((p) => ({
        network: p.network,
        content: (p.content ?? "Untitled").slice(0, 160),
        engagement: Math.round(engagementOf(p)),
        reach: p.reach ?? p.impressions ?? 0,
        url: p.url ?? null,
        publishedAt: p.publishedAt ?? null,
      }));

    const byFormat = new Map<string, { sum: number; count: number }>();
    for (const p of allPosts) {
      const f = fmtLabel(p.type);
      const cur = byFormat.get(f) ?? { sum: 0, count: 0 };
      cur.sum += engagementOf(p);
      cur.count += 1;
      byFormat.set(f, cur);
    }
    bestFormats = [...byFormat.entries()]
      .map(([format, v]) => ({ format, avgEngagement: Math.round(v.sum / v.count), count: v.count }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);
    contentBreakdown = [...byFormat.entries()]
      .map(([format, v]) => ({ format, count: v.count }))
      .sort((a, b) => b.count - a.count);
  } catch (e) {
    autoError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    connected: true,
    autoError,
    topPosts,
    bestFormats,
    contentBreakdown,
    reportLinks: REPORT_LINKS,
    ...manual,
  });
}

export async function POST(request: Request) {
  const denied = await guardUser();
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Coerce/validate into the stored shapes.
  const audIn = (o.audience && typeof o.audience === "object" ? o.audience : {}) as Record<string, unknown>;
  const ageGroups = Array.isArray(audIn.ageGroups)
    ? audIn.ageGroups
        .map((r) => ({ label: String((r as Record<string, unknown>)?.label ?? "").slice(0, 40), pct: Number((r as Record<string, unknown>)?.pct) || 0 }))
        .filter((r) => r.label)
    : [];
  const topCities = Array.isArray(audIn.topCities)
    ? audIn.topCities
        .map((r) => ({ name: String((r as Record<string, unknown>)?.name ?? "").slice(0, 60), pct: Number((r as Record<string, unknown>)?.pct) || 0 }))
        .filter((r) => r.name)
    : [];
  const topics = Array.isArray(o.topics)
    ? o.topics
        .map((r) => {
          const rec = r as Record<string, unknown>;
          const status = String(rec?.status ?? "warm").toLowerCase();
          return {
            topic: String(rec?.topic ?? "").slice(0, 120),
            status: ["hot", "warm", "growing"].includes(status) ? status : "warm",
          };
        })
        .filter((r) => r.topic)
    : [];
  const suggestion = typeof o.suggestion === "string" ? o.suggestion.slice(0, 2000) : "";

  try {
    const db = await getTenantDb();
    const { error } = await db.upsert(
      "social_insights",
      { audience: { ageGroups, topCities }, topics, suggestion },
      { onConflict: "tenant_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}
