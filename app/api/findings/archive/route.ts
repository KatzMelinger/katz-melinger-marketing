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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("archive_closed_findings", { p_days: DAYS });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ archived: data ?? 0, olderThanDays: DAYS });
}
