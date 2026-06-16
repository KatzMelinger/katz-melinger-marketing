/**
 * GET /api/seo/technical/autopilot-fixes
 *   query: url? (any URL on the site — its host scopes the list to one domain)
 *
 * Dashboard read for the AutoPilot Fixes lifecycle tab. Returns every fix for
 * the tenant (optionally one domain) across all statuses, plus status counts,
 * so the tab can show the full suggested → approved → queued → applied / failed
 * lifecycle. Session-authed (guardUser) and tenant-scoped — distinct from the
 * token-authed plugin routes under /api/wp/*.
 */

import { NextRequest, NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import {
  countFixesByStatus,
  listDashboardFixes,
  normalizeDomain,
} from "@/lib/wp-autopilot";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;

  const url = new URL(req.url);
  const urlParam = url.searchParams.get("url") ?? "";
  let domain: string | undefined;
  if (urlParam) {
    try {
      domain = normalizeDomain(new URL(urlParam).host);
    } catch {
      domain = normalizeDomain(urlParam) || undefined;
    }
  }

  try {
    const tenantId = await resolveTenantId();
    const [items, counts] = await Promise.all([
      listDashboardFixes({ tenantId, domain, limit: 200 }),
      countFixesByStatus({ tenantId, domain }),
    ]);
    return NextResponse.json({ items, counts, domain: domain ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
