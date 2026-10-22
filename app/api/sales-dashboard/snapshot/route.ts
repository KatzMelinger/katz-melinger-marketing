/**
 * GET /api/sales-dashboard/snapshot — Vercel Cron, hourly. See
 * lib/sales-dashboard/snapshot.ts. Requires `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextRequest, NextResponse } from "next/server";

import { snapshotIntakeStaff } from "@/lib/sales-dashboard/snapshot";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { withJobRun } from "@/lib/job-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function runScheduled(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await snapshotIntakeStaff(getSupabaseAdmin()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/sales-dashboard/snapshot", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
