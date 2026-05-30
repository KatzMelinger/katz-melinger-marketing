/**
 * POST /api/content/site-inventory/ingest-url
 *   body: { urls: string[] }
 *
 * Fast per-URL ingest into the site_pages cluster map. Used when a single
 * page is published — much cheaper than running the full sitemap crawl. The
 * daily cron still catches anything missed by direct calls.
 *
 * Auth: same as the rest of the dashboard's authenticated /api/content routes.
 * (Future: accept an X-KM-AutoPilot-Token header so a WP plugin hook can
 *  call this directly from WordPress on save_post — schema is already
 *  domain-scoped in wp_autopilot_tokens.)
 */

import { NextRequest, NextResponse } from "next/server";

import { ingestUrls } from "@/lib/site-inventory";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { urls?: unknown };
  const urls = Array.isArray(body.urls)
    ? (body.urls as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  if (urls.length === 0) {
    return NextResponse.json(
      { error: "urls (string[]) required" },
      { status: 400 },
    );
  }
  try {
    const result = await ingestUrls(urls);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
