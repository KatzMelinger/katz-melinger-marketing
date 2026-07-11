/**
 * Per-post analytics refresh (Phase 4).
 *
 * GET  /api/social/metrics/refresh — Vercel Cron (Bearer CRON_SECRET). Refreshes
 *      the default tenant's live posts that are due per the publish / 7-day /
 *      30-day cadence.
 * POST /api/social/metrics/refresh — manual trigger for the current tenant.
 *      Body: { "id": "<social_posts id>" } to refresh one post now (ignores the
 *      cadence), or {} to refresh everything currently due.
 *
 * Metrics come from Ayrshare and are stored on the post's social_posts row.
 */

import { NextRequest, NextResponse } from "next/server";

import { guardUser } from "@/lib/supabase-route";
import { getSupabaseServer } from "@/lib/supabase-server";
import { DEFAULT_TENANT_ID, resolveTenantId } from "@/lib/tenant-context";
import { refreshPostMetrics } from "@/lib/social-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const result = await refreshPostMetrics(supabase, DEFAULT_TENANT_ID, { limit: 100 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service-role client not configured" }, { status: 503 });
  }
  const tenantId = await resolveTenantId();
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const onlyId = typeof body.id === "string" && body.id ? body.id : undefined;

  const result = await refreshPostMetrics(supabase, tenantId, { onlyId, limit: 100 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
