/**
 * GET /api/legal/questions/reminders   (Vercel Cron, weekdays 9:00 New York)
 *
 * Oct 20 spec, Task A14: remind each attorney about questions open 2+ business
 * days, and show Kenneth every question open 4+ business days.
 */
import { NextRequest, NextResponse } from "next/server";
import { listTenantIds } from "@/lib/tenant-db";
import { sendReminders } from "@/lib/attorney-questions";
import { withJobRun } from "@/lib/job-runs";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function runScheduled(req: NextRequest) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  for (const tenantId of await listTenantIds()) {
    out[tenantId] = await sendReminders(tenantId).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  }
  return NextResponse.json({ ok: true, results: out });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/legal/questions/reminders", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
