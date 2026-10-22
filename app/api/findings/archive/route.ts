/**
 * GET /api/findings/archive — Vercel Cron, daily. Requires
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Oct 6 spec, Task 25: closed findings older than 30 days move to
 * content_findings_archive and are no longer loaded in History. The move is
 * one database function (supabase/content_findings_task25.sql), across every
 * tenant: dismissed and "approved as is" findings stay, since the next
 * analysis needs those decisions.
 */
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { withJobRun } from "@/lib/job-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 30;

async function runScheduled(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("archive_closed_findings", { p_days: DAYS });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ archived: data ?? 0, olderThanDays: DAYS });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/findings/archive", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
