"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type DimensionRollup = {
  dimension_key: string;
  dimension_name: string;
  calls: number;
  earned: number;
  possible: number;
  pct: number;
};

type AgentRollup = {
  agent_email: string;
  scored_count: number;
  avg_overall: number | null;
  trend_delta: number | null;
  rubric_breakdown: Record<string, number>;
  weaknesses: DimensionRollup[];
  strengths: DimensionRollup[];
  recent_calls: Array<{
    call_id: string;
    overall_score: number | null;
    rubric_type: string | null;
    scored_at: string | null;
  }>;
};

type ApiResponse = {
  agents: AgentRollup[];
  team: { agents_with_scores: number; total_scored_calls: number };
  error?: string;
};

const RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: 0 },
] as const;

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-slate-500/20 text-slate-600 ring-slate-500/30";
  if (score >= 85) return "bg-emerald-500/20 text-emerald-700 ring-emerald-500/30";
  if (score >= 70) return "bg-blue-500/20 text-blue-700 ring-blue-500/30";
  if (score >= 50) return "bg-amber-500/20 text-amber-700 ring-amber-500/30";
  return "bg-rose-500/20 text-rose-700 ring-rose-500/30";
}

function pctBarColor(pct: number): string {
  if (pct >= 80) return "#166534";
  if (pct >= 60) return "#116AB2";
  if (pct >= 40) return "#b45309";
  return "#be123c";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d);
}

export function CoachingClient() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState<number>(90);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (days > 0) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        params.set("since", since);
      }
      const res = await fetch(`/api/calls/coaching?${params.toString()}`, { cache: "no-store" });
      const j = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(j.error ?? `Load failed (${res.status})`);
        return;
      }
      setData(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(rangeDays);
  }, [load, rangeDays]);

  const teamAvg = useMemo(() => {
    if (!data?.agents.length) return null;
    const scored = data.agents.filter((a) => a.avg_overall != null);
    if (!scored.length) return null;
    const weightedSum = scored.reduce((s, a) => s + (a.avg_overall ?? 0) * a.scored_count, 0);
    const weight = scored.reduce((s, a) => s + a.scored_count, 0);
    return weight ? Math.round(weightedSum / weight) : null;
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRangeDays(r.days)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
              rangeDays === r.days
                ? "bg-brand text-white ring-brand"
                : "bg-white text-slate-600 ring-[#e2e8f0] hover:bg-slate-50"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          {data ? `${data.team.agents_with_scores} agents · ${data.team.total_scored_calls} scored calls` : ""}
          {teamAvg != null ? ` · team avg ${teamAvg}` : ""}
        </span>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : !data || data.agents.length === 0 ? (
        <p className="text-slate-500">
          No scored calls in this range yet. Score some calls from the{" "}
          <Link href="/calls" className="text-brand hover:underline">
            Calls
          </Link>{" "}
          page first.
        </p>
      ) : (
        <div className="space-y-4">
          {data.agents.map((a) => (
            <AgentCard key={a.agent_email} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentRollup }) {
  const rubricParts = Object.entries(agent.rubric_breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");

  return (
    <article className="rounded-xl border border-[#e2e8f0] p-5" style={{ backgroundColor: "#ffffff" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{agent.agent_email}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {agent.scored_count} scored {agent.scored_count === 1 ? "call" : "calls"}
            {rubricParts ? ` · ${rubricParts}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {agent.trend_delta != null ? (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                agent.trend_delta > 0
                  ? "bg-emerald-500/20 text-emerald-700 ring-emerald-500/30"
                  : agent.trend_delta < 0
                    ? "bg-rose-500/20 text-rose-700 ring-rose-500/30"
                    : "bg-slate-500/20 text-slate-600 ring-slate-500/30"
              }`}
              title="Recent-half average minus prior-half average"
            >
              {agent.trend_delta > 0 ? "▲" : agent.trend_delta < 0 ? "▼" : "▬"} {Math.abs(agent.trend_delta)}
            </span>
          ) : null}
          <span
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold ring-1 ${scoreColor(agent.avg_overall)}`}
          >
            {agent.avg_overall ?? "—"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <DimensionList title="Recurring weaknesses" dims={agent.weaknesses} emptyLabel="Not enough data" />
        <DimensionList title="Strengths" dims={agent.strengths} emptyLabel="Not enough data" />
      </div>

      {agent.recent_calls.length ? (
        <div className="mt-4 border-t border-[#e2e8f0] pt-3">
          <p className="mb-2 text-xs font-medium text-slate-500">Recent scored calls</p>
          <div className="flex flex-wrap gap-2">
            {agent.recent_calls.map((c) => (
              <Link
                key={c.call_id}
                href={`/calls/${encodeURIComponent(c.call_id)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[#e2e8f0] px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                <span className={`inline-flex rounded-full px-1.5 py-0.5 font-medium ring-1 ${scoreColor(c.overall_score)}`}>
                  {c.overall_score ?? "—"}
                </span>
                <span>{formatDate(c.scored_at)}</span>
                {c.rubric_type ? <span className="text-slate-400">{c.rubric_type}</span> : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DimensionList({
  title,
  dims,
  emptyLabel,
}: {
  title: string;
  dims: DimensionRollup[];
  emptyLabel: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-500">{title}</p>
      {dims.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {dims.map((d) => (
            <li key={d.dimension_key}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{d.dimension_name}</span>
                <span className="tabular-nums text-slate-500">{d.pct}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${d.pct}%`, backgroundColor: pctBarColor(d.pct) }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
