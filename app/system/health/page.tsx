"use client";

/**
 * System health (Oct 20 spec, Task A17): every background job with its last
 * success, last error and next run, and this month's AI and data cost. The
 * hourly watchdog emails Diana and Kenneth about any problem shown here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { DashCard, DashPill, DashSpinner } from "@/components/dashboard-ui";

type Job = {
  job: string;
  label: string;
  schedule: string | null;
  lastSuccess: string | null;
  lastError: { at: string; error: string } | null;
  running: { since: string } | null;
  nextRun: string | null;
  problem: string | null;
};
type Payload = {
  recorded: boolean;
  jobs: Job[];
  cost: { monthCents: number; byMeter: Record<string, number>; topDrafts: { draftId: string; cents: number; calls: number }[]; budgetUsd: number | null; overBudget: boolean } | null;
  titles: Record<string, string>;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function SystemHealthPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/system/health", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load");
        setData(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const problems = data?.jobs.filter((j) => j.problem) ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">System health</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every background job: when it last succeeded, its last error and its next run. The watchdog checks hourly and emails Diana
          and Kenneth about a failed, missed or stuck job, and retries it once.
        </p>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {!data && !error && (
        <DashCard className="py-10 text-center text-sm text-slate-500">
          <DashSpinner /> Loading…
        </DashCard>
      )}
      {data && !data.recorded && (
        <DashCard className="border-amber-300 bg-amber-50 text-sm text-amber-900">
          Job runs are not recorded yet: run <code>supabase/system_health_a17.sql</code> once. Until then this page shows schedules
          and the jobs read from their own records only.
        </DashCard>
      )}
      {data && (
        <DashCard>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">Jobs</span>
            <DashPill tone={problems.length ? "red" : "emerald"}>{problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}` : "all healthy"}</DashPill>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Job</th>
                  <th className="py-1 pr-3">Last success</th>
                  <th className="py-1 pr-3">Last error</th>
                  <th className="py-1 pr-3">Next run</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.job} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium text-slate-800">{j.label}</div>
                      <div className="text-[10px] text-slate-400">{j.schedule ? `${j.job} · ${j.schedule} UTC` : j.job}</div>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{when(j.lastSuccess)}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{j.lastError ? `${when(j.lastError.at)}: ${j.lastError.error.slice(0, 120)}` : "none"}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{j.nextRun ? when(j.nextRun) : "on demand"}</td>
                    <td className="py-1.5">
                      {j.problem ? (
                        <span className="text-rose-700">{j.problem}</span>
                      ) : j.running ? (
                        <span className="text-sky-700">running since {when(j.running.since)}</span>
                      ) : (
                        <span className="text-emerald-700">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}
      {data?.cost && (
        <DashCard>
          <div className="text-sm font-semibold text-slate-900">AI and data cost this month</div>
          <p className="mt-1 text-sm text-slate-700">
            {usd(data.cost.monthCents)}
            {data.cost.budgetUsd !== null ? ` of a $${data.cost.budgetUsd} budget` : " (no monthly budget set: Brand settings monthlyAiBudgetUsd)"}
            {data.cost.overBudget ? " · over budget: automatic runs are paused" : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {Object.entries(data.cost.byMeter)
              .map(([m, c]) => `${m} ${usd(c)}`)
              .join(" · ") || "No metered calls yet."}
          </p>
          {data.cost.topDrafts.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
              {data.cost.topDrafts.map((d) => (
                <li key={d.draftId}>
                  <Link href={`/content/drafts?id=${d.draftId}`} className="text-brand hover:underline">
                    {data.titles[d.draftId] ?? d.draftId.slice(0, 8)}
                  </Link>{" "}
                  {usd(d.cents)} ({d.calls} calls)
                </li>
              ))}
            </ul>
          )}
        </DashCard>
      )}
    </div>
  );
}
