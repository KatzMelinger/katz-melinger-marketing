/**
 * GET  /api/calls/needs-callback/email   (Vercel Cron, 12:00 and 13:00 UTC)
 * POST /api/calls/needs-callback/email   send it now (signed-in user; a test)
 *
 * Oct 20 spec, Task A19: the Needs callback list emailed at 8:00 AM New York
 * time with the PDF attached. The cron fires at both UTC hours so 8 AM is
 * hit in daylight and standard time; the send only happens when it is 8 in
 * New York and has not gone out today.
 */
import { NextRequest, NextResponse } from "next/server";
import { listTenantIds } from "@/lib/tenant-db";
import { guardUser } from "@/lib/supabase-route";
import { resolveTenantId } from "@/lib/tenant-context";
import { sendDailyCallbackEmail } from "@/lib/callback-export";
import { withJobRun } from "@/lib/job-runs";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function runScheduled(req: NextRequest) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  for (const tenantId of await listTenantIds()) {
    out[tenantId] = await sendDailyCallbackEmail(tenantId).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  }
  return NextResponse.json({ ok: true, results: out });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/calls/needs-callback/email", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}

export async function POST() {
  const denied = await guardUser();
  if (denied) return denied;
  try {
    return NextResponse.json(await sendDailyCallbackEmail(await resolveTenantId(), { force: true }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
