/**
 * GET  /api/seo/technical?url=…   — returns the latest cached scan
 * POST /api/seo/technical?url=…   — runs a fresh scan, persists, returns it
 *
 * PageSpeed Insights is slow (~30-60s per call). The page renders the cached
 * data immediately; the user clicks "Re-scan" to refresh on demand.
 */

import { NextRequest, NextResponse } from "next/server";

import { getTechnicalSeoMonitoring } from "@/lib/seo-intelligence";
import { SEMRUSH_DOMAIN } from "@/lib/semrush";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function defaultUrl(url: string | null): string {
  return url && url.trim() ? url : `https://${SEMRUSH_DOMAIN}`;
}

export async function GET(request: NextRequest) {
  const url = defaultUrl(request.nextUrl.searchParams.get("url"));
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ url, latest: null });
  }
  const { data } = await supabase
    .from("technical_seo_runs")
    .select("*")
    .eq("url", url)
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = (data ?? [])[0] ?? null;
  return NextResponse.json({ url, latest });
}

export async function POST(request: NextRequest) {
  const url = defaultUrl(request.nextUrl.searchParams.get("url"));
  try {
    const data = await getTechnicalSeoMonitoring(url);
    const supabase = getSupabaseServer();
    if (supabase) {
      await supabase.from("technical_seo_runs").insert({
        url,
        mobile: data.mobile,
        desktop: data.desktop,
        schema_checks: data.schemaChecks,
        crawl_errors: data.crawlErrors,
        status: "success",
      });
    }
    return NextResponse.json({
      url,
      latest: {
        mobile: data.mobile,
        desktop: data.desktop,
        schema_checks: data.schemaChecks,
        crawl_errors: data.crawlErrors,
        created_at: new Date().toISOString(),
        status: "success",
        error: null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed technical seo scan";
    const supabase = getSupabaseServer();
    if (supabase) {
      await supabase.from("technical_seo_runs").insert({
        url,
        mobile: [],
        desktop: [],
        status: "failed",
        error: msg,
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
