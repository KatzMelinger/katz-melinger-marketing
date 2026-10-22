/**
 * GET /api/content/results/run   (Vercel Cron, daily 10:30 UTC)
 *
 * Oct 20 spec, Task A10: record the 30 and 90 day results of published
 * pages (Underperforming ones go to the Refresh Queue), re-run every
 * regression case made from a manual correction, and on the 1st of the month
 * email Diana and the Admins the check-vs-results report.
 */
import { NextRequest, NextResponse } from "next/server";
import { listTenantIds } from "@/lib/tenant-db";
import { measureDuePages, reportText, resultsOverview } from "@/lib/page-results";
import { runRegressionCases } from "@/lib/regression-cases";
import { loadPublishers } from "@/lib/publish-permission";
import { adminEmails, sendEmails } from "@/lib/notify-shared";
import { withJobRun } from "@/lib/job-runs";
import { FIRM_TZ } from "@/lib/calls-stats";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function runScheduled(req: NextRequest) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const firstOfMonth = new Date().toLocaleDateString("en-CA", { timeZone: FIRM_TZ }).endsWith("-01");
  const out: Record<string, unknown> = {};
  for (const tenantId of await listTenantIds()) {
    try {
      const measured = await measureDuePages(tenantId);
      const cases = await runRegressionCases(tenantId);
      let reportSent = 0;
      if (firstOfMonth || req.nextUrl.searchParams.get("report") === "1") {
        const { pages, report } = await resultsOverview(tenantId);
        const withResults = pages.filter((p) => p.results.d30 || p.results.d90).length;
        const to = [...new Set([...(await loadPublishers(tenantId)), ...adminEmails()])];
        reportSent = await sendEmails(to, "Monthly report: which content checks predict results", reportText(report, withResults));
      }
      out[tenantId] = { measured, cases, reportSent };
    } catch (e) {
      out[tenantId] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ ok: true, results: out });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(...args: Parameters<typeof runScheduled>) {
  return withJobRun("/api/content/results/run", (args as unknown[])[0] as Request | undefined, () => runScheduled(...args));
}
