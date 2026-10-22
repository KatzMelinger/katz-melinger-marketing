/**
 * GET /api/legal/live-scan   (Vercel Cron, daily 10:00 UTC)
 *
 * Oct 20 spec, Task A15: scan the next batch of live pages not scanned in 90
 * days (so every blog and practice page is checked each quarter), and open
 * refresh drafts for pages citing a figure that changes within 30 days.
 */
import { NextRequest, NextResponse } from "next/server";
import { listTenantIds } from "@/lib/tenant-db";
import { refreshForDatedFacts, scanDuePages } from "@/lib/live-page-scan";
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
  const origin = new URL(req.url).origin;
  const out: Record<string, unknown> = {};
  for (const tenantId of await listTenantIds()) {
    try {
      const scan = await scanDuePages(tenantId);
      const dated = "missing" in scan ? [] : await refreshForDatedFacts(tenantId, origin);
      out[tenantId] = "missing" in scan ? { skipped: "run supabase/learn_results_a10_a15.sql" } : { scanned: scan.scanned.length, remaining: scan.remaining, dated };
    } catch (e) {
      out[tenantId] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, results: out });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/legal/live-scan", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
