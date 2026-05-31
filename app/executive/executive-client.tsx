"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type DeltaT = { abs: number; pct: number | null };

type MetricsResponse = {
  window: { since: string; until: string; days: number };
  previous: { since: string; until: string };
  current: { calls: number; answered: number; missed: number; scored: number; avg_score: number | null; spend: number };
  prior: { calls: number; answered: number; missed: number; scored: number; avg_score: number | null; spend: number };
  deltas: Record<string, DeltaT>;
  series: { date: string; calls: number }[];
  error?: string;
};

type FunnelRow = { source: string; intakes: number; matters: number; settlements: number; revenue: number; spend: number };
type FunnelResponse = { rows?: FunnelRow[] };

type Ga4Response = { sessions?: number; newUsers?: number; error?: string };

type FunnelTotals = { intakes: number; matters: number; settlements: number; revenue: number; spend: number };

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function sumFunnel(rows: FunnelRow[]): FunnelTotals {
  return rows.reduce(
    (a, r) => ({
      intakes: a.intakes + (r.intakes ?? 0),
      matters: a.matters + (r.matters ?? 0),
      settlements: a.settlements + (r.settlements ?? 0),
      revenue: a.revenue + (r.revenue ?? 0),
      spend: a.spend + (r.spend ?? 0),
    }),
    { intakes: 0, matters: 0, settlements: 0, revenue: 0, spend: 0 },
  );
}

function pctDelta(current: number, prior: number): number | null {
  if (prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

/** Tiny inline-SVG sparkline; no chart dependency. */
function Sparkline({ data, color = "#185FA5" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const w = 240;
  const h = 40;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function DeltaBadge({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct == null) return <span className="text-xs text-slate-400">—</span>;
  const up = pct > 0;
  const good = up === goodWhenUp;
  if (pct === 0) return <span className="text-xs text-slate-400">0%</span>;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-emerald-600" : "text-rose-500"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export function ExecutiveClient() {
  const [since, setSince] = useState(isoDaysAgo(29));
  const [until, setUntil] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [funnelCur, setFunnelCur] = useState<FunnelTotals | null>(null);
  const [funnelPrior, setFunnelPrior] = useState<FunnelTotals | null>(null);
  const [ga4Cur, setGa4Cur] = useState<Ga4Response | null>(null);
  const [ga4Prior, setGa4Prior] = useState<Ga4Response | null>(null);

  const load = useCallback(async (s: string, u: string) => {
    setLoading(true);
    setError(null);
    try {
      const mRes = await fetch(`/api/metrics/overview?since=${s}&until=${u}`, { cache: "no-store" });
      const m = (await mRes.json()) as MetricsResponse;
      if (!mRes.ok) {
        setError(m.error ?? `Metrics failed (${mRes.status})`);
        setLoading(false);
        return;
      }
      setMetrics(m);

      const prev = m.previous;
      const [fCurRes, fPriorRes, gCurRes, gPriorRes] = await Promise.all([
        fetch(`/api/cms/funnel-by-source?since=${m.window.since}&until=${m.window.until}`, { cache: "no-store" }),
        fetch(`/api/cms/funnel-by-source?since=${prev.since}&until=${prev.until}`, { cache: "no-store" }),
        fetch(`/api/analytics/overview?since=${m.window.since}&until=${m.window.until}`, { cache: "no-store" }),
        fetch(`/api/analytics/overview?since=${prev.since}&until=${prev.until}`, { cache: "no-store" }),
      ]);
      const [fCur, fPrior, gCur, gPrior] = await Promise.all([
        fCurRes.ok ? (fCurRes.json() as Promise<FunnelResponse>) : Promise.resolve({ rows: [] }),
        fPriorRes.ok ? (fPriorRes.json() as Promise<FunnelResponse>) : Promise.resolve({ rows: [] }),
        gCurRes.ok ? (gCurRes.json() as Promise<Ga4Response>) : Promise.resolve({}),
        gPriorRes.ok ? (gPriorRes.json() as Promise<Ga4Response>) : Promise.resolve({}),
      ]);
      setFunnelCur(sumFunnel(fCur.rows ?? []));
      setFunnelPrior(sumFunnel(fPrior.rows ?? []));
      setGa4Cur(gCur);
      setGa4Prior(gPrior);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(since, until);
  }, [load, since, until]);

  function applyPreset(days: number) {
    setSince(isoDaysAgo(days - 1));
    setUntil(todayIso());
  }

  const stages = useMemo(() => {
    if (!metrics) return [];
    const spend = metrics.current.spend;
    const sessions = ga4Cur?.sessions ?? 0;
    const calls = metrics.current.calls;
    const intakes = funnelCur?.intakes ?? 0;
    const matters = funnelCur?.matters ?? 0;
    const revenue = funnelCur?.revenue ?? 0;

    const sessionsPrior = ga4Prior?.sessions ?? 0;
    const intakesPrior = funnelPrior?.intakes ?? 0;
    const mattersPrior = funnelPrior?.matters ?? 0;
    const revenuePrior = funnelPrior?.revenue ?? 0;

    return [
      { key: "spend", label: "Spend", value: fmtUsd(spend), pct: metrics.deltas.spend?.pct ?? null, goodUp: false, tone: "#b45309" },
      { key: "sessions", label: "Site sessions", value: fmtNum(sessions), pct: pctDelta(sessions, sessionsPrior), goodUp: true, tone: "#185FA5" },
      { key: "calls", label: "Calls", value: fmtNum(calls), pct: metrics.deltas.calls?.pct ?? null, goodUp: true, tone: "#0f4c75" },
      { key: "intakes", label: "Intakes", value: fmtNum(intakes), pct: pctDelta(intakes, intakesPrior), goodUp: true, tone: "#166534" },
      { key: "matters", label: "Matters", value: fmtNum(matters), pct: pctDelta(matters, mattersPrior), goodUp: true, tone: "#475569" },
      { key: "revenue", label: "Revenue", value: fmtUsd(revenue), pct: pctDelta(revenue, revenuePrior), goodUp: true, tone: "#7c3aed" },
    ];
  }, [metrics, ga4Cur, ga4Prior, funnelCur, funnelPrior]);

  const derived = useMemo(() => {
    if (!metrics) return null;
    const spend = metrics.current.spend;
    const intakes = funnelCur?.intakes ?? 0;
    const revenue = funnelCur?.revenue ?? 0;
    const calls = metrics.current.calls;
    return {
      cpa: intakes > 0 ? spend / intakes : 0,
      costPerCall: calls > 0 ? spend / calls : 0,
      roiPct: spend > 0 ? ((revenue - spend) / spend) * 100 : null,
      answerRate: calls > 0 ? (metrics.current.answered / calls) * 100 : 0,
      avgScore: metrics.current.avg_score,
    };
  }, [metrics, funnelCur]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const active = since === isoDaysAgo(p.days - 1) && until === todayIso();
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ${
                active ? "bg-[#185FA5] text-white ring-[#185FA5]" : "bg-white text-slate-600 ring-[#e2e8f0] hover:bg-slate-50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="date"
            value={since}
            max={until}
            onChange={(e) => setSince(e.target.value)}
            className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-slate-900"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={until}
            min={since}
            max={todayIso()}
            onChange={(e) => setUntil(e.target.value)}
            className="rounded-lg border border-[#e2e8f0] bg-white px-2 py-1.5 text-slate-900"
          />
        </div>
      </div>

      {metrics ? (
        <p className="text-xs text-slate-500">
          {metrics.window.since} → {metrics.window.until} ({metrics.window.days} days) vs prior{" "}
          {metrics.previous.since} → {metrics.previous.until}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{error}</div>
      ) : null}

      {loading && !metrics ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          {/* The funnel chain */}
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stages.map((s) => (
              <article key={s.key} className="rounded-xl border border-white/5 p-4 shadow-sm" style={{ backgroundColor: s.tone }}>
                <p className="text-xs font-medium text-white/90">{s.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-white">{s.value}</p>
                <div className="mt-1">
                  <span className="rounded bg-white/15 px-1.5 py-0.5">
                    <DeltaBadge pct={s.pct} goodWhenUp={s.goodUp} />
                  </span>
                </div>
              </article>
            ))}
          </section>

          {/* Derived economics */}
          {derived ? (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label="ROI" value={derived.roiPct == null ? "—" : `${derived.roiPct.toFixed(0)}%`} />
              <Kpi label="CPA (per intake)" value={fmtUsd(derived.cpa)} />
              <Kpi label="Cost per call" value={fmtUsd(derived.costPerCall)} />
              <Kpi label="Answer rate" value={`${derived.answerRate.toFixed(0)}%`} />
              <Kpi label="Avg coach score" value={derived.avgScore != null ? String(derived.avgScore) : "—"} />
            </section>
          ) : null}

          {/* Calls sparkline */}
          {metrics && metrics.series.length > 1 ? (
            <section className="rounded-xl border border-[#e2e8f0] p-5" style={{ backgroundColor: "#ffffff" }}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Daily calls</h2>
                <span className="text-xs text-slate-500">
                  {fmtNum(metrics.current.calls)} total · <DeltaBadge pct={metrics.deltas.calls?.pct ?? null} /> vs prior period
                </span>
              </div>
              <Sparkline data={metrics.series.map((d) => d.calls)} />
            </section>
          ) : null}

          <p className="text-xs text-slate-500">
            Spend and calls are date-scoped from your data. Site sessions come from GA4. Intakes, matters, and
            revenue come from the CMS funnel —{" "}
            <Link href="/attribution" className="text-[#185FA5] hover:underline">
              see per-channel attribution
            </Link>
            . Set spend in{" "}
            <Link href="/settings/marketing-spend" className="text-[#185FA5] hover:underline">
              Marketing spend
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] p-5 shadow-sm" style={{ backgroundColor: "#ffffff" }}>
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
    </article>
  );
}
