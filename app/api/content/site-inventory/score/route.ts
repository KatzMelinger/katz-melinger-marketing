/**
 * POST /api/content/site-inventory/score  — manual "Score pages" (UI button)
 * GET  /api/content/site-inventory/score  — monthly cron (CRON_SECRET-gated)
 *
 * Fetches each published page and scores SEO/AEO/CASH onto site_pages, feeding
 * the Site Inventory "Optimize" tab. Bounded per run; long-running so it takes
 * the max duration. Mirrors the site-inventory/crawl route's cron pattern.
 */

import { NextRequest, NextResponse } from "next/server";

import { scoreSitePages } from "@/lib/site-page-scoring";
import { guardUser } from "@/lib/supabase-route";
import { getTenantClient, listTenantIds } from "@/lib/tenant-db";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantIds = await listTenantIds();
  const perTenant: Record<string, unknown> = {};
  for (const tenantId of tenantIds) {
    try {
      perTenant[tenantId] = await scoreSitePages({ tenantId });
    } catch (e) {
      perTenant[tenantId] = {
        error: e instanceof Error ? e.message : "score failed",
      };
    }
  }
  return NextResponse.json({ tenants: tenantIds.length, perTenant });
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const { tenantId } = await getTenantClient();
  try {
    const result = await scoreSitePages({ tenantId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "score failed" },
      { status: 500 },
    );
  }
}
