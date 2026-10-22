/**
 * GET /api/legal/kb-refresh   (Vercel Cron, every 2 hours at :20)
 *
 * Oct 20 spec, Task A15: make the refresh drafts still waiting after a
 * knowledge base change or a coming dated fact, four at a time.
 */
import { NextRequest, NextResponse } from "next/server";
import { listTenantIds } from "@/lib/tenant-db";
import { processRefreshQueue } from "@/lib/live-page-scan";
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
    out[tenantId] = await processRefreshQueue(tenantId, origin, { limit: 4, deadlineMs: Date.now() + 270_000 }).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
  }
  return NextResponse.json({ ok: true, results: out });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/legal/kb-refresh", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
