"use client";

/**
 * Performance report — the marketing P&L. The "operating" layout (last week)
 * is a tight pulse; the "strategic" layout (last month / last 30 days) adds the
 * full spend→revenue funnel and channel table. Numbers come from the same
 * date-scoped endpoints as the Executive dashboard.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DeltaBadge,
  fmtNum,
  fmtPct,
  fmtUsd,
  inRange,
  Kpi,
  type PeriodKey,
  prettyDate,
  pctDelta,
  ReportFrame,
  Section,
  Sparkline,
  windowForPeriod,
} from "@/app/reporting/report-ui";

type DeltaT = { abs: number; pct: number | null };
type MetricsResponse = {
  window: { since: string; until: string; days: number };
  previous: { since: string; until: string };
  current: { calls: number; answered: number; missed: number; voicemail: number; scored: number; avg_score: number | null; spend: number };
  prior: { calls: number; answered: number; missed: number; voicemail: number; scored: number; avg_score: number | null; spend: number };
  deltas: Record<string, DeltaT>;
  series: { date: string; calls: number }[];
  error?: string;
};
type FunnelRow = { source: string; intakes: number; matters: number; settlements: number; revenue: number; spend: number };
type FunnelResponse = { rows?: FunnelRow[] };
type FunnelTotals = { intakes: number; matters: number; settlements: number; revenue: number; spend: number };
type Ga4Response = { sessions?: number; newUsers?: number; activeUsers?: number; bounceRate?: number; averageSessionDuration?: number; error?: string };
type GscResponse = { totalClicks?: number; totalImpressions?: number; avgCtr?: number; avgPosition?: number; error?: string };
type ReviewRow = { rating?: number; review_date?: string; platform?: string };
type ReviewsResponse = { reviews?: ReviewRow[] };
type RecItem = { id: string; title: string; category?: string; impact?: string; status?: string };
type RecsResponse = { items?: RecItem[] };

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

export function PerformanceReport({ period }: { period: PeriodKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [funnelCur, setFunnelCur] = useState<FunnelRow[]>([]);
  const [funnelPrior, setFunnelPrior] = useState<FunnelTotals | null>(null);
  const [ga4Cur, setGa4Cur] = useState<Ga4Response | null>(null);
  const [ga4Prior, setGa4Prior] = useState<Ga4Response | null>(null);
  const [gsc, setGsc] = useState<GscResponse | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [recs, setRecs] = useState<RecItem[]>([]);

  const w = useMemo(() => windowForPeriod(period), [period]);
  const strategic = w.layout === "strategic";

  const load = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    setError(null);
    try {
      const win = windowForPeriod(p);
      const mRes = await fetch(`/api/metrics/overview?since=${win.since}&until=${win.until}`, { cache: "no-store" });
      const m = (await mRes.json()) as MetricsResponse;
      if (!mRes.ok) {
        setError(m.error ?? `Metrics failed (${mRes.status})`);
        setLoading(false);
        return;
      }
      setMetrics(m);
      const prev = m.previous;
      const [fCur, fPrior, gCur, gPrior, gscRes, revRes, recRes] = await Promise.all([
        fetch(`/api/cms/funnel-by-source?since=${m.window.since}&until=${m.window.until}`, { cache: "no-store" }),
        fetch(`/api/cms/funnel-by-source?since=${prev.since}&until=${prev.until}`, { cache: "no-store" }),
        fetch(`/api/analytics/overview?since=${m.window.since}&until=${m.window.until}`, { cache: "no-store" }),
        fetch(`/api/analytics/overview?since=${prev.since}&until=${prev.until}`, { cache: "no-store" }),
        fetch(`/api/search-console/overview`, { cache: "no-store" }),
        fetch(`/api/reviews`, { cache: "no-store" }),
        fetch(`/api/recommendations/items?status=active`, { cache: "no-store" }),
      ]);
      const [fCurJson, fPriorJson, gCurJson, gPriorJson, gscJson, revJson, recJson] = await Promise.all([
        fCur.ok ? (fCur.json() as Promise<FunnelResponse>) : Promise.resolve({ rows: [] }),
        fPrior.ok ? (fPrior.json() as Promise<FunnelResponse>) : Promise.resolve({ rows: [] }),
        gCur.ok ? (gCur.json() as Promise<Ga4Response>) : Promise.resolve({}),
        gPrior.ok ? (gPrior.json() as Promise<Ga4Response>) : Promise.resolve({}),
        gscRes.ok ? (gscRes.json() as Promise<GscResponse>) : Promise.resolve({}),
        revRes.ok ? (revRes.json() as Promise<ReviewsResponse>) : Promise.resolve({ reviews: [] }),
        recRes.ok ? (recRes.json() as Promise<RecsResponse>) : Promise.resolve({ items: [] }),
      ]);
      setFunnelCur(fCurJson.rows ?? []);
      setFunnelPrior(sumFunnel(fPriorJson.rows ?? []));
      setGa4Cur(gCurJson);
      setGa4Prior(gPriorJson);
      setGsc(gscJson);
      setReviews(revJson.reviews ?? []);
      setRecs(recJson.items ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const funnelTotals = useMemo(() => sumFunnel(funnelCur), [funnelCur]);

  const reviewStats = useMemo(() => {
    if (!metrics) return null;
    const { since, until } = metrics.window;
    const { since: pSince, until: pUntil } = metrics.previous;
    let curN = 0;
    let curSum = 0;
    let priorN = 0;
    for (const r of reviews) {
      const d = (r.review_date ?? "").slice(0, 10);
      if (!d) continue;
      if (inRange(d, since, until)) {
        curN += 1;
        curSum += Number(r.rating) || 0;
      } else if (inRange(d, pSince, pUntil)) {
        priorN += 1;
      }
    }
    const allRated = reviews.filter((r) => Number(r.rating) > 0);
    const allAvg = allRated.length ? allRated.reduce((s, r) => s + Number(r.rating), 0) / allRated.length : null;
    return { curN, priorN, curAvg: curN ? curSum / curN : null, allAvg, allCount: reviews.length };
  }, [reviews, metrics]);

  const econ = useMemo(() => {
    if (!metrics) return null;
    const spend = metrics.current.spend;
    const { intakes, revenue } = funnelTotals;
    const calls = metrics.current.calls;
    const sessions = ga4Cur?.sessions ?? 0;
    return {
      spend,
      revenue,
      cpa: intakes > 0 ? spend / intakes : null,
      costPerCall: calls > 0 ? spend / calls : null,
      costPerSession: sessions > 0 ? spend / sessions : null,
      roiPct: spend > 0 ? ((revenue - spend) / spend) * 100 : null,
      roas: spend > 0 ? revenue / spend : null,
      answerRate: calls > 0 ? (metrics.current.answered / calls) * 100 : 0,
      priorAnswerRate: metrics.prior.calls > 0 ? (metrics.prior.answered / metrics.prior.calls) * 100 : 0,
      intakeRate: calls > 0 ? (intakes / calls) * 100 : null,
    };
  }, [metrics, funnelTotals, ga4Cur]);

  const narrative = useMemo(() => {
    if (!metrics || !econ) return [];
    const lines: string[] = [];
    const callsPct = metrics.deltas.calls?.pct ?? null;
    const dir = (p: number | null) => (p == null ? "held roughly flat" : p > 0 ? `rose ${Math.abs(p)}%` : `fell ${Math.abs(p)}%`);
    lines.push(
      `The firm logged ${fmtNum(metrics.current.calls)} inbound calls this ${w.periodWord} — volume ${dir(callsPct)} versus the ${w.priorWord} — and converted them into ${fmtNum(funnelTotals.intakes)} new intakes.`,
    );
    lines.push(
      `${fmtPct(econ.answerRate)} of calls were answered live (${fmtNum(metrics.current.missed)} missed), and marketing spend of ${fmtUsd(econ.spend)} produced ${econ.cpa != null ? `a blended cost per intake of ${fmtUsd(econ.cpa)}` : "no booked intakes yet this period"}.`,
    );
    if (econ.roiPct != null) {
      lines.push(
        `Attributed revenue of ${fmtUsd(econ.revenue)} against that spend is a ${econ.roiPct >= 0 ? "positive" : "negative"} ROI of ${fmtPct(econ.roiPct)} (${econ.roas != null ? `${econ.roas.toFixed(1)}× ROAS` : "ROAS n/a"}).`,
      );
    }
    const sessPct = pctDelta(ga4Cur?.sessions ?? 0, ga4Prior?.sessions ?? 0);
    if ((ga4Cur?.sessions ?? 0) > 0) lines.push(`Website sessions ${dir(sessPct)} to ${fmtNum(ga4Cur?.sessions ?? 0)}.`);
    if (reviewStats && reviewStats.curN > 0) {
      lines.push(
        `Reputation added ${fmtNum(reviewStats.curN)} new review${reviewStats.curN === 1 ? "" : "s"}${reviewStats.curAvg != null ? ` averaging ${reviewStats.curAvg.toFixed(1)}★` : ""}.`,
      );
    }
    return lines;
  }, [metrics, econ, funnelTotals, ga4Cur, ga4Prior, reviewStats, w]);

  const funnelChain = useMemo(() => {
    if (!metrics) return [];
    const sessions = ga4Cur?.sessions ?? 0;
    const sessionsPrior = ga4Prior?.sessions ?? 0;
    return [
      { key: "spend", label: "Spend", value: fmtUsd(metrics.current.spend), pct: metrics.deltas.spend?.pct ?? null, goodUp: false, tone: "#b45309" },
      { key: "sessions", label: "Sessions", value: fmtNum(sessions), pct: pctDelta(sessions, sessionsPrior), goodUp: true, tone: "#116AB2" },
      { key: "calls", label: "Calls", value: fmtNum(metrics.current.calls), pct: metrics.deltas.calls?.pct ?? null, goodUp: true, tone: "#0f4c75" },
      { key: "intakes", label: "Intakes", value: fmtNum(funnelTotals.intakes), pct: pctDelta(funnelTotals.intakes, funnelPrior?.intakes ?? 0), goodUp: true, tone: "#166534" },
      { key: "matters", label: "Matters", value: fmtNum(funnelTotals.matters), pct: pctDelta(funnelTotals.matters, funnelPrior?.matters ?? 0), goodUp: true, tone: "#475569" },
      { key: "revenue", label: "Revenue", value: fmtUsd(funnelTotals.revenue), pct: pctDelta(funnelTotals.revenue, funnelPrior?.revenue ?? 0), goodUp: true, tone: "#7c3aed" },
    ];
  }, [metrics, ga4Cur, ga4Prior, funnelTotals, funnelPrior]);

  const topChannels = useMemo(
    () => [...funnelCur].sort((a, b) => b.revenue - a.revenue || b.intakes - a.intakes).slice(0, 8),
    [funnelCur],
  );

  if (loading && !metrics) return <p className="text-slate-500">Compiling report…</p>;
  if (error) return <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{error}</div>;
  if (!metrics) return null;

  // Section numbers: the strategic layout inserts the funnel as section 2.
  const n = (base: number) => (strategic ? base : base - 1);

  return (
    <ReportFrame
      title={`${strategic ? "Strategic Review" : "Operating Report"} — ${w.label}`}
      periodLabel={`${prettyDate(metrics.window.since)} – ${prettyDate(metrics.window.until)} (${metrics.window.days} days) · compared to ${prettyDate(metrics.previous.since)} – ${prettyDate(metrics.previous.until)}`}
      footer="Spend and calls are date-scoped from MarketOS; sessions from GA4; intakes, matters, and revenue from the CMS funnel; organic search from Google Search Console (trailing 28 days). Figures are directional where a source has no data for the window."
    >
      <Section num={1} title="Executive summary">
        <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          {narrative.length ? narrative.map((line, i) => <p key={i}>{line}</p>) : <p>Not enough data in this window to summarize.</p>}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="New intakes" value={fmtNum(funnelTotals.intakes)} pct={pctDelta(funnelTotals.intakes, funnelPrior?.intakes ?? 0)} />
          <Kpi label="Marketing spend" value={fmtUsd(metrics.current.spend)} pct={metrics.deltas.spend?.pct ?? null} goodWhenUp={false} />
          <Kpi label="Cost per intake" value={econ?.cpa != null ? fmtUsd(econ.cpa) : "—"} goodWhenUp={false} />
          <Kpi label="Attributed revenue" value={fmtUsd(funnelTotals.revenue)} pct={pctDelta(funnelTotals.revenue, funnelPrior?.revenue ?? 0)} />
        </div>
      </Section>

      {strategic ? (
        <Section num={2} title="Marketing funnel" blurb="End to end: every dollar of spend through to attributed revenue.">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {funnelChain.map((s) => (
              <article key={s.key} className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: s.tone }}>
                <p className="text-xs font-medium text-white/90">{s.label}</p>
                <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight text-white">{s.value}</p>
                <div className="mt-1">
                  <span className="rounded bg-white/15 px-1.5 py-0.5">
                    <DeltaBadge pct={s.pct} goodWhenUp={s.goodUp} />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      <Section num={n(3)} title="Demand & intake" blurb="Inbound volume and how well the front desk converts it — the firm's revenue pulse.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Inbound calls" value={fmtNum(metrics.current.calls)} pct={metrics.deltas.calls?.pct ?? null} />
          <Kpi label="Answer rate" value={fmtPct(econ?.answerRate ?? 0)} pct={pctDelta(econ?.answerRate ?? 0, econ?.priorAnswerRate ?? 0)} hint={`${fmtNum(metrics.current.missed)} missed`} />
          <Kpi label="New intakes" value={fmtNum(funnelTotals.intakes)} pct={pctDelta(funnelTotals.intakes, funnelPrior?.intakes ?? 0)} />
          <Kpi label="Call → intake rate" value={econ?.intakeRate != null ? fmtPct(econ.intakeRate) : "—"} hint="intakes ÷ calls" />
        </div>
        {metrics.current.avg_score != null ? (
          <p className="text-xs text-slate-500">
            Average intake-call coaching score this {w.periodWord}: <strong className="text-slate-700">{metrics.current.avg_score}/100</strong> across {fmtNum(metrics.current.scored)} scored calls.
          </p>
        ) : null}
      </Section>

      <Section num={n(4)} title="Spend & efficiency" blurb="What we paid, and what it cost to generate demand.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total spend" value={fmtUsd(metrics.current.spend)} pct={metrics.deltas.spend?.pct ?? null} goodWhenUp={false} />
          <Kpi label="Cost per call" value={econ?.costPerCall != null ? fmtUsd(econ.costPerCall) : "—"} goodWhenUp={false} />
          <Kpi label="Cost per intake (CPA)" value={econ?.cpa != null ? fmtUsd(econ.cpa) : "—"} goodWhenUp={false} />
          {strategic ? (
            <Kpi label="ROI" value={econ?.roiPct != null ? fmtPct(econ.roiPct) : "—"} hint={econ?.roas != null ? `${econ.roas.toFixed(1)}× ROAS` : undefined} />
          ) : (
            <Kpi label="Cost per session" value={econ?.costPerSession != null ? fmtUsd(econ.costPerSession) : "—"} goodWhenUp={false} />
          )}
        </div>
      </Section>

      <Section num={n(5)} title="Traffic & search visibility" blurb="Top of funnel — how many people the firm reached and how it shows up in search.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Website sessions" value={fmtNum(ga4Cur?.sessions ?? 0)} pct={pctDelta(ga4Cur?.sessions ?? 0, ga4Prior?.sessions ?? 0)} />
          <Kpi label="New users" value={fmtNum(ga4Cur?.newUsers ?? 0)} pct={pctDelta(ga4Cur?.newUsers ?? 0, ga4Prior?.newUsers ?? 0)} />
          <Kpi label="Engagement" value={ga4Cur?.averageSessionDuration ? `${Math.round(ga4Cur.averageSessionDuration)}s` : "—"} hint={ga4Cur?.bounceRate != null ? `${(ga4Cur.bounceRate * 100).toFixed(0)}% bounce` : undefined} />
          <Kpi label="Avg. search position" value={gsc?.avgPosition ? gsc.avgPosition.toFixed(1) : "—"} goodWhenUp={false} hint="organic, trailing 28d" />
        </div>
        {gsc && (gsc.totalClicks || gsc.totalImpressions) ? (
          <p className="text-xs text-slate-500">
            Google organic (trailing 28 days): <strong className="text-slate-700">{fmtNum(gsc.totalClicks ?? 0)}</strong> clicks from <strong className="text-slate-700">{fmtNum(gsc.totalImpressions ?? 0)}</strong> impressions{gsc.avgCtr != null ? <> · {(gsc.avgCtr * 100).toFixed(1)}% CTR</> : null}.
          </p>
        ) : null}
      </Section>

      {strategic && topChannels.length ? (
        <Section num={6} title="Channel performance" blurb="Where intakes, matters, and revenue came from — sorted by revenue.">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Spend</th>
                  <th className="px-3 py-2 text-right font-medium">Intakes</th>
                  <th className="px-3 py-2 text-right font-medium">Matters</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">CPA</th>
                  <th className="px-3 py-2 text-right font-medium">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topChannels.map((r) => {
                  const cpa = r.intakes > 0 ? r.spend / r.intakes : null;
                  const roi = r.spend > 0 ? ((r.revenue - r.spend) / r.spend) * 100 : null;
                  return (
                    <tr key={r.source} className="text-slate-700">
                      <td className="px-3 py-2 font-medium text-slate-900">{r.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.spend ? fmtUsd(r.spend) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.intakes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.matters)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.revenue ? fmtUsd(r.revenue) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{cpa != null ? fmtUsd(cpa) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{roi != null ? <span className={roi >= 0 ? "text-emerald-600" : "text-rose-500"}>{fmtPct(roi)}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            Channel attribution is sourced from the CMS funnel. See{" "}
            <Link href="/attribution" className="text-[#4F46E5] hover:underline print:no-underline">Attribution</Link> for the full breakdown.
          </p>
        </Section>
      ) : null}

      <Section num={n(7)} title="Reputation" blurb="Reviews are both a ranking signal and the first thing a prospect reads.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label={`New reviews this ${w.periodWord}`} value={fmtNum(reviewStats?.curN ?? 0)} pct={pctDelta(reviewStats?.curN ?? 0, reviewStats?.priorN ?? 0)} />
          <Kpi label="Avg rating (new)" value={reviewStats?.curAvg != null ? `${reviewStats.curAvg.toFixed(1)}★` : "—"} />
          <Kpi label="Standing rating" value={reviewStats?.allAvg != null ? `${reviewStats.allAvg.toFixed(2)}★` : "—"} hint={`${fmtNum(reviewStats?.allCount ?? 0)} total`} />
        </div>
      </Section>

      {metrics.series.length > 1 ? (
        <Section num={n(8)} title="Daily call volume" blurb="Inbound calls per day across the reporting window.">
          <div className="rounded-xl border border-slate-200 p-4">
            <Sparkline data={metrics.series.map((d) => d.calls)} />
            <div className="mt-1 flex justify-between text-[11px] text-slate-400">
              <span>{prettyDate(metrics.series[0].date)}</span>
              <span>{fmtNum(metrics.current.calls)} calls total</span>
              <span>{prettyDate(metrics.series[metrics.series.length - 1].date)}</span>
            </div>
          </div>
        </Section>
      ) : null}

      <Section num={n(9)} title="Priorities & next actions" blurb="The open recommendation queue — what the team is acting on next.">
        {recs.length ? (
          <ul className="space-y-2">
            {recs.slice(0, strategic ? 8 : 5).map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${r.impact === "high" ? "bg-rose-100 text-rose-700" : r.impact === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                  {r.impact ?? "—"}
                </span>
                <div className="min-w-0">
                  <p className="text-slate-800">{r.title}</p>
                  {r.category ? <p className="text-[11px] text-slate-400">{r.category}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            No open recommendations. Generate a fresh set on the{" "}
            <Link href="/recommendations" className="text-[#4F46E5] hover:underline print:no-underline">Recommendations</Link> page.
          </p>
        )}
      </Section>
    </ReportFrame>
  );
}
