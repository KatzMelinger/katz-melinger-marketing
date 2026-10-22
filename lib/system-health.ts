/**
 * System health (Oct 20 spec, Task A17): every background job with its last
 * success, last error and next run, and the problems the watchdog alerts on:
 * a failed run, a missed scheduled run, or a run going longer than 2 hours.
 *
 * The scheduled jobs come from vercel.json (the same file that schedules
 * them, so the list cannot drift). Jobs that are not cron routes are read
 * from their own records: the AEO sweep (aeo_runs), the WordPress plugin
 * (its last sync), Improve to Ready and the source check (the audit trail).
 */
import vercelConfig from "@/vercel.json";
import { getSupabaseAdmin } from "./supabase-server";
import { recentJobRuns, type JobRunRow } from "./job-runs";

const LABELS: Record<string, string> = {
  "/api/connections/keepalive": "Connections keep-alive",
  "/api/calls/sync": "CallRail sync",
  "/api/calls/score-pending?mode=submit": "Call scoring (submit)",
  "/api/calls/score-pending?mode=collect": "Call scoring (collect)",
  "/api/seo/radar/discover": "Radar discovery",
  "/api/findings/archive": "Findings archive",
  "/api/sales-dashboard/snapshot": "Sales dashboard snapshot",
  "/api/forms/sync": "Forms sync",
  "/api/leads/leakage/snapshot": "Lead response snapshot",
  "/api/seo/tracked-keywords/refresh": "Search Console / rank refresh",
  "/api/seo/opportunities/sync": "Opportunities sync (DataForSEO)",
  "/api/content/site-inventory/crawl": "Site inventory crawl",
  "/api/aeo/runs/start": "AEO sweep (start)",
  "/api/agent/run": "Autonomous content agent",
  "/api/content/site-inventory/score": "Site inventory scoring",
  "/api/social/report/snapshot": "Monthly social report",
  "/api/social/metrics/refresh": "Social metrics refresh",
  "/api/seo/citations/weekly-audit": "Citations audit",
  "/api/social/linkedin/health": "LinkedIn connection check",
  "/api/legal/authority-watch": "Legal authority watch",
  "/api/legal/questions/reminders": "Attorney question reminders",
  "/api/system/watchdog": "Watchdog (this page's alerts)",
};

/* ------------------------------------------------------------------------- */
/* Cron schedules (UTC, as Vercel runs them)                                 */
/* ------------------------------------------------------------------------- */

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b ?? (stepS ? max : a);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

function matches(schedule: string, d: Date): boolean {
  const [m, h, dom, mon, dow] = schedule.trim().split(/\s+/);
  return (
    field(m, 0, 59).has(d.getUTCMinutes()) &&
    field(h, 0, 23).has(d.getUTCHours()) &&
    field(dom, 1, 31).has(d.getUTCDate()) &&
    field(mon, 1, 12).has(d.getUTCMonth() + 1) &&
    field(dow, 0, 6).has(d.getUTCDay())
  );
}

/** The next time the schedule fires after `from` (searches 40 days ahead). */
export function nextRun(schedule: string, from: Date = new Date()): Date | null {
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 60 * 24 * 40; i++, d.setTime(d.getTime() + 60000)) if (matches(schedule, d)) return new Date(d);
  return null;
}

/** The last time the schedule fired at or before `at` (searches 40 days back). */
export function previousRun(schedule: string, at: Date = new Date()): Date | null {
  const d = new Date(Math.floor(at.getTime() / 60000) * 60000);
  for (let i = 0; i < 60 * 24 * 40; i++, d.setTime(d.getTime() - 60000)) if (matches(schedule, d)) return new Date(d);
  return null;
}

/* ------------------------------------------------------------------------- */
/* Health                                                                    */
/* ------------------------------------------------------------------------- */

export type JobHealth = {
  job: string;
  label: string;
  schedule: string | null;
  lastSuccess: string | null;
  lastError: { at: string; error: string } | null;
  running: { since: string } | null;
  nextRun: string | null;
  problem: string | null;
  source: "job_runs" | "derived";
};

const GRACE_MS = 20 * 60 * 1000;
const RUNNING_LIMIT_MS = 2 * 60 * 60 * 1000;

/** Pure: one scheduled job's health from its runs. */
export function scheduledHealth(job: string, schedule: string, runs: JobRunRow[], now: Date = new Date()): JobHealth {
  const mine = runs.filter((r) => r.job === job).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const ok = mine.find((r) => r.status === "ok");
  const failed = mine.find((r) => r.status === "failed");
  const running = mine.find((r) => r.status === "running");
  const latest = mine[0];
  const prev = previousRun(schedule, new Date(now.getTime() - GRACE_MS));
  let problem: string | null = null;
  if (running && now.getTime() - Date.parse(running.started_at) > RUNNING_LIMIT_MS) problem = `Running for more than 2 hours (since ${running.started_at}).`;
  else if (latest?.status === "failed") problem = `Last run failed: ${latest.error ?? "unknown error"}.`;
  else if (prev && mine.length > 0 && !mine.some((r) => Date.parse(r.started_at) >= prev.getTime() - 60000)) problem = `Missed its scheduled run at ${prev.toISOString()}.`;
  return {
    job,
    label: LABELS[job] ?? job,
    schedule,
    lastSuccess: ok?.finished_at ?? ok?.started_at ?? null,
    lastError: failed ? { at: failed.started_at, error: failed.error ?? "unknown error" } : null,
    running: running ? { since: running.started_at } : null,
    nextRun: nextRun(schedule, now)?.toISOString() ?? null,
    problem,
    source: "job_runs",
  };
}

export const SCHEDULES: { job: string; schedule: string }[] = (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons?.map((c) => ({ job: c.path, schedule: c.schedule })) ?? [];

async function derivedJobs(tenantId: string): Promise<JobHealth[]> {
  const sb = getSupabaseAdmin();
  const out: JobHealth[] = [];
  // The AEO sweep runs in chunks after the cron starts it.
  const { data: aeo } = await sb.from("aeo_runs").select("status, created_at, completed_at, error").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10);
  const aeoOk = (aeo ?? []).find((r) => r.status === "done");
  const aeoFail = (aeo ?? []).find((r) => r.status === "failed");
  const aeoRun = (aeo ?? []).find((r) => r.status === "running" || r.status === "pending");
  out.push({
    job: "aeo_sweep",
    label: "AEO sweep (all prompts)",
    schedule: null,
    lastSuccess: (aeoOk?.completed_at as string | null) ?? null,
    lastError: aeoFail ? { at: aeoFail.created_at as string, error: (aeoFail.error as string | null) ?? "failed" } : null,
    running: aeoRun ? { since: aeoRun.created_at as string } : null,
    nextRun: nextRun("0 12 * * 1")?.toISOString() ?? null,
    problem: aeo?.[0]?.status === "failed" ? `Last sweep failed: ${aeo[0].error ?? "unknown"}.` : null,
    source: "derived",
  });
  // WordPress plugin: when it last pulled, and drafts stuck in its queue.
  const { data: tok } = await sb.from("wp_autopilot_tokens").select("last_used_at").eq("tenant_id", tenantId).order("last_used_at", { ascending: false, nullsFirst: false }).limit(1);
  const lastPull = (tok?.[0]?.last_used_at as string | null) ?? null;
  const { data: queued } = await sb.from("content_drafts").select("id, metadata").eq("tenant_id", tenantId).eq("status", "approved").range(0, 199);
  const stuck = (queued ?? []).filter((d) => {
    const wp = ((d.metadata as Record<string, unknown> | null)?.wp_publish ?? {}) as Record<string, unknown>;
    const at = String(wp.queued_at ?? wp.go_live_at ?? "");
    return (wp.queued === true || wp.go_live_requested === true) && at && Date.now() - Date.parse(at) > 2 * 60 * 60 * 1000;
  }).length;
  out.push({
    job: "wordpress_publish",
    label: "WordPress publish (site plugin)",
    schedule: null,
    lastSuccess: lastPull,
    lastError: null,
    running: null,
    nextRun: null,
    problem: stuck ? `${stuck} draft${stuck === 1 ? " has" : "s have"} waited over 2 hours for the site plugin.` : null,
    source: "derived",
  });
  // Improve to Ready and the source check, from the audit trail.
  const { data: ev } = await sb.from("content_audit_log").select("event, created_at").eq("tenant_id", tenantId).in("event", ["improve_to_ready", "source_check"]).order("created_at", { ascending: false }).limit(50);
  for (const [event, label] of [["improve_to_ready", "Improve to Ready runs"], ["source_check", "Source checks"]] as const) {
    const last = (ev ?? []).find((e) => e.event === event);
    out.push({ job: event, label, schedule: null, lastSuccess: (last?.created_at as string | null) ?? null, lastError: null, running: null, nextRun: null, problem: null, source: "derived" });
  }
  return out;
}

export async function systemHealth(tenantId: string): Promise<{ recorded: boolean; jobs: JobHealth[] }> {
  const runs = await recentJobRuns();
  const scheduled = SCHEDULES.map((s) =>
    runs ? scheduledHealth(s.job, s.schedule, runs) : { job: s.job, label: LABELS[s.job] ?? s.job, schedule: s.schedule, lastSuccess: null, lastError: null, running: null, nextRun: nextRun(s.schedule)?.toISOString() ?? null, problem: null, source: "job_runs" as const },
  );
  const derived = await derivedJobs(tenantId).catch(() => [] as JobHealth[]);
  return { recorded: runs !== null, jobs: [...scheduled, ...derived] };
}
