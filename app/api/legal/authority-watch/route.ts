/**
 * GET  /api/legal/authority-watch
 *   (Vercel Cron trigger — requires Authorization: Bearer ${CRON_SECRET})
 *   Re-checks every tenant's cached legal citations for EVERY active tenant.
 *
 * POST /api/legal/authority-watch
 *   (UI / manual trigger — runs the caller's tenant only)
 *
 * See lib/legal-authority-watch.ts for what this actually does and why it
 * exists — the proactive half of "immediate update whenever a law changes"
 * that the legal_facts_cache TTL alone can't provide.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveTenantId } from "@/lib/tenant-context";
import { listTenantIds } from "@/lib/tenant-db";
import { runAuthorityWatch } from "@/lib/legal-authority-watch";
import { guardUser } from "@/lib/supabase-route";

export const runtime = "nodejs";
// One live fetch per cached citation, across every tenant — give the fleet
// loop room the same way /api/agent/run does.
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantIds = await listTenantIds();
  const results = [];
  for (const tenantId of tenantIds) {
    // One tenant's failure must not abort the rest of the fleet.
    try {
      results.push({ tenantId, ...(await runAuthorityWatch(tenantId)) });
    } catch (err) {
      results.push({ tenantId, error: err instanceof Error ? err.message : "watch failed" });
    }
  }
  return NextResponse.json({ tenants: results.length, results });
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  const tenantId = await resolveTenantId();
  const result = await runAuthorityWatch(tenantId);
  return NextResponse.json(result);
}
