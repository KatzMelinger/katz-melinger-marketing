/**
 * GET /api/system/watchdog   (Vercel Cron, hourly)
 *
 * Oct 20 spec, Task A17: a job that fails, misses its schedule or runs longer
 * than 2 hours emails Diana and Kenneth, and is retried once automatically.
 * Over the monthly AI budget, Kenneth is told (once a day). Each problem is
 * alerted once: the job_runs row is marked, or a marker row is written.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { listTenantIds } from "@/lib/tenant-db";
import { recentJobRuns, withJobRun } from "@/lib/job-runs";
import { SCHEDULES, previousRun, systemHealth } from "@/lib/system-health";
import { adminEmails, sendEmails } from "@/lib/notify-shared";
import { loadPublishers } from "@/lib/publish-permission";
import { costSummary } from "@/lib/ai-cost";

export const runtime = "nodejs";
export const maxDuration = 120;

const KENNETH = "kjkatz@katzmelinger.com";

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${expected}`;
}

async function retry(origin: string, job: string) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;
  try {
    await fetch(`${origin}${job}`, {
      headers: { authorization: `Bearer ${secret}`, "x-km-job-trigger": "retry" },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* the retry keeps running in its own invocation; a timeout here is expected */
  }
}

async function runWatchdog(req: NextRequest) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getSupabaseAdmin();
  const runs = await recentJobRuns();
  const origin = req.nextUrl.origin;
  const alerts: string[] = [];
  const now = Date.now();

  if (runs) {
    for (const { job, schedule } of SCHEDULES) {
      if (job === "/api/system/watchdog") continue;
      const mine = runs.filter((r) => r.job === job);
      const latest = mine[0];
      // Running more than 2 hours: it will not finish.
      const stale = mine.find((r) => r.status === "running" && now - Date.parse(r.started_at) > 2 * 3600_000);
      if (stale) {
        await sb
          .from("job_runs")
          .update({ status: "failed", error: "Ran for more than 2 hours (stopped or timed out).", finished_at: new Date().toISOString(), alerted: true })
          .eq("id", stale.id);
        alerts.push(`${job}: ran for more than 2 hours.`);
        await retry(origin, job);
        continue;
      }
      if (latest?.status === "failed" && !latest.alerted) {
        await sb.from("job_runs").update({ alerted: true }).eq("id", latest.id);
        alerts.push(`${job}: failed (${latest.error ?? "unknown error"})${latest.trigger === "retry" ? " on its automatic retry" : "; retrying once"}.`);
        if (latest.trigger !== "retry") await retry(origin, job);
        continue;
      }
      // Missed: nothing recorded since the last scheduled time (20 minutes' grace).
      const prev = previousRun(schedule, new Date(now - 20 * 60_000));
      if (prev && mine.length > 0 && !mine.some((r) => Date.parse(r.started_at) >= prev.getTime() - 60_000)) {
        await sb.from("job_runs").insert({
          job,
          status: "failed",
          trigger: "watchdog",
          alerted: true,
          error: `Missed its scheduled run at ${prev.toISOString()}.`,
          started_at: prev.toISOString(),
          finished_at: new Date().toISOString(),
        });
        alerts.push(`${job}: missed its scheduled run at ${prev.toISOString()}; retrying once.`);
        await retry(origin, job);
      }
    }
  }

  const recipients = new Set([KENNETH, ...adminEmails()]);
  for (const tenantId of await listTenantIds()) {
    for (const p of await loadPublishers(tenantId)) recipients.add(p);
    // Jobs read from their own records (AEO sweep, WordPress plugin): once a day per problem.
    const health = await systemHealth(tenantId).catch(() => null);
    for (const j of health?.jobs.filter((x) => x.source === "derived" && x.problem) ?? []) {
      const marker = `derived:${j.job}`;
      if (runs?.some((r) => r.job === marker && now - Date.parse(r.started_at) < 24 * 3600_000)) continue;
      if (runs) await sb.from("job_runs").insert({ job: marker, status: "failed", trigger: "watchdog", alerted: true, error: j.problem, finished_at: new Date().toISOString() });
      alerts.push(`${j.label}: ${j.problem}`);
    }
    // The monthly AI budget, once a day.
    const cost = await costSummary(tenantId).catch(() => null);
    if (cost?.overBudget && !runs?.some((r) => r.job === "ai_budget" && now - Date.parse(r.started_at) < 24 * 3600_000)) {
      if (runs) await sb.from("job_runs").insert({ job: "ai_budget", status: "failed", trigger: "watchdog", alerted: true, error: "over budget", finished_at: new Date().toISOString() });
      await sendEmails(
        [KENNETH],
        "Huraqan: monthly AI budget reached",
        `This month's AI and data cost is $${(cost.monthCents / 100).toFixed(2)}, over the $${cost.budgetUsd} budget. ` +
          'Automatic runs (Improve to Ready on new drafts) are paused; the buttons still work. Raise or clear "monthlyAiBudgetUsd" in Brand settings to resume.',
      ).catch(() => 0);
    }
  }

  if (alerts.length) {
    await sendEmails(
      [...recipients],
      `Huraqan System health: ${alerts.length} problem${alerts.length === 1 ? "" : "s"}`,
      `${alerts.map((a) => `- ${a}`).join("\n")}\n\nSystem health: ${process.env.NEXT_PUBLIC_APP_URL ?? origin}/system/health`,
    ).catch(() => 0);
  }
  return NextResponse.json({ ok: true, alerts, recorded: runs !== null });
}

/** Oct 20 spec, Task A17: a scheduled run is recorded for System health and the watchdog. */
export async function GET(req: NextRequest) {
  return withJobRun("/api/system/watchdog", req, () => runWatchdog(req));
}
