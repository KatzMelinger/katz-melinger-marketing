/**
 * GET /api/connections/keepalive  (Vercel Cron)
 *
 * Refreshes OAuth connections that are near expiry so they never lapse from
 * idleness — the main mitigation for Constant Contact's rotating refresh token
 * going cold. Runs from ONE place (the prod cron) so rotation stays centralized.
 *
 * Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}` on scheduled
 * runs. A logged-in user may also trigger it manually (the "Refresh now" button
 * on the health badge). Anything else is rejected when CRON_SECRET is set.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { keepAliveConnections } from "@/lib/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    // Not the cron — allow an authenticated user to trigger it manually.
    const denied = await guardUser();
    if (denied) return denied;
  }

  const results = await keepAliveConnections();
  return NextResponse.json({ ok: true, results, ran_at: new Date().toISOString() });
}
