/**
 * POST /api/content/site-inventory/crawl  — manual re-crawl (UI button)
 * GET  /api/content/site-inventory/crawl  — cron re-crawl (CRON_SECRET-gated)
 *
 * Rebuilds the site_pages cluster map from the sitemap. Long-running, so the
 * route gives itself the max duration.
 */

import { NextRequest, NextResponse } from "next/server";

import { crawlSiteInventory } from "@/lib/site-inventory";
import { listTenantIds } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";

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
  try {
    // Cron: crawl every tenant's own site into its own tenant-scoped inventory.
    const tenantIds = await listTenantIds();
    const perTenant: Record<string, unknown> = {};
    for (const tenantId of tenantIds) {
      try {
        const cfg = await getTenantConfig(tenantId);
        perTenant[tenantId] = await crawlSiteInventory({
          domain: cfg.semrushDomain,
          tenantId,
        });
      } catch (e) {
        perTenant[tenantId] = {
          error: e instanceof Error ? e.message : "crawl failed",
        };
      }
    }
    return NextResponse.json({ tenants: tenantIds.length, perTenant });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "crawl failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    domain?: unknown;
    maxPages?: unknown;
  };
  try {
    const result = await crawlSiteInventory({
      domain: typeof body.domain === "string" ? body.domain : undefined,
      maxPages: typeof body.maxPages === "number" ? body.maxPages : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "crawl failed" },
      { status: 500 },
    );
  }
}
