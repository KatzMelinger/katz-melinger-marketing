/**
 * Background job runs (Oct 20 spec, Task A17): every scheduled route records
 * when it ran, how it ended and any error, so the System health page can show
 * each job's last success, last error and next run, and the watchdog can
 * alert and retry. Before supabase/system_health_a17.sql is run, recording is
 * a no-op and the job itself is unaffected.
 */
import { getSupabaseAdmin } from "./supabase-server";

export function isCronCall(req: Request | undefined): boolean {
  const s = process.env.CRON_SECRET?.trim();
  return !!s && !!req && req.headers.get("authorization") === `Bearer ${s}`;
}

function isMissingTable(message: string | undefined): boolean {
  return !!message && /job_runs|does not exist|schema cache/i.test(message);
}

/**
 * Run a scheduled route's handler and record the run. Only cron-authorized
 * calls are recorded (a person opening the same URL is not a scheduled run).
 * The X-KM-Job-Trigger header marks a watchdog retry.
 */
export async function withJobRun(fallbackJob: string, req: Request | undefined, run: () => Promise<Response>): Promise<Response> {
  if (!isCronCall(req)) return run();
  // The schedule's own path, query included (/api/calls/score-pending?mode=submit).
  let job = fallbackJob;
  try {
    const u = new URL(req!.url);
    job = u.pathname + u.search;
  } catch {
    /* keep the fallback */
  }
  const sb = getSupabaseAdmin();
  const trigger = req?.headers.get("x-km-job-trigger") === "retry" ? "retry" : "cron";
  const started = Date.now();
  let id: string | null = null;
  try {
    const { data, error } = await sb.from("job_runs").insert({ job, status: "running", trigger }).select("id").single();
    if (!error) id = data?.id ?? null;
    else if (!isMissingTable(error.message)) console.warn("[job-runs] insert failed:", error.message);
  } catch {
    /* recording must never stop the job */
  }
  let res: Response;
  try {
    res = await run();
  } catch (e) {
    if (id) {
      await sb
        .from("job_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), duration_ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) })
        .eq("id", id);
    }
    throw e;
  }
  if (id) {
    let error: string | null = null;
    if (res.status >= 400) {
      try {
        const j = (await res.clone().json()) as { error?: unknown };
        error = typeof j?.error === "string" ? j.error : `HTTP ${res.status}`;
      } catch {
        error = `HTTP ${res.status}`;
      }
    }
    await sb
      .from("job_runs")
      .update({ status: res.status >= 400 ? "failed" : "ok", finished_at: new Date().toISOString(), duration_ms: Date.now() - started, http_status: res.status, error })
      .eq("id", id);
  }
  return res;
}

export type JobRunRow = {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed";
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
  trigger: string;
  alerted: boolean;
};

/** The last runs of every job (null when the table is not there yet). */
export async function recentJobRuns(limit = 2000): Promise<JobRunRow[] | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("job_runs")
    .select("*")
    .gte("started_at", new Date(Date.now() - 35 * 864e5).toISOString())
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return isMissingTable(error.message) ? null : [];
  return (data ?? []) as JobRunRow[];
}
