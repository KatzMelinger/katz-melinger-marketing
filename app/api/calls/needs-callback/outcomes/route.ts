/**
 * GET /api/calls/needs-callback/outcomes?from&to
 *
 * Oct 20 spec, Task A19: how the follow-up went in the range: callers marked
 * called back, reached or dead, and consultations booked.
 */
import { NextRequest, NextResponse } from "next/server";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { isIsoDate, monthToDate } from "@/lib/calls-stats";
import { callbackOutcomes } from "@/lib/callback-export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await guardUser();
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const d = monthToDate(Date.now());
  const from = isIsoDate(sp.get("from")) ? (sp.get("from") as string) : d.from;
  const to = isIsoDate(sp.get("to")) ? (sp.get("to") as string) : d.to;
  return NextResponse.json({ outcomes: await callbackOutcomes(await resolveTenantId(), from, to) });
}
