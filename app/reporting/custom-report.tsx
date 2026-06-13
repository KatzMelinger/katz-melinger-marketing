"use client";

/**
 * Custom report — the CMO describes what they want in plain English (and/or
 * picks which areas to include), and Claude assembles a tailored report from
 * the same metric set the other tabs use. We gather a compact metrics bundle
 * for the cadence window once, then POST the request + bundle to
 * /api/reporting/ai-digest (kind: "custom").
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { inRange, type PeriodKey, prettyDate, ReportFrame, Section, windowForPeriod } from "@/app/reporting/report-ui";

type CustomResult = { title: string; summary: string; sections: { heading: string; bullets: string[] }[] };

type MetricsLike = { current?: { calls?: number; answered?: number; missed?: number; avg_score?: number | null; spend?: number }; deltas?: Record<string, { pct: number | null }> };
type FunnelLike = { rows?: { intakes?: number; matters?: number; revenue?: number; spend?: number; source?: string }[] };
type Ga4Like = { sessions?: number; newUsers?: number; bounceRate?: number };
type ReviewsLike = { reviews?: { rating?: number; review_date?: string }[] };
type DraftsLike = { drafts?: { format?: string; created_at?: string }[] };
type KeywordsLike = { tracked?: { keyword: string; position?: number; positionDelta?: number }[] };
type AeoLike = { selfMentionRatePct?: number; promptCoverage?: { total: number; covered: number; pct: number } };

const SCOPES = [
  { key: "demand", label: "Demand & intake (calls, intakes)" },
  { key: "spend", label: "Spend, CPA & ROI" },
  { key: "traffic", label: "Traffic & SEO" },
  { key: "aeo", label: "AI search visibility" },
  { key: "content", label: "Content production" },
  { key: "reputation", label: "Reviews & reputation" },
] as const;
type ScopeKey = (typeof SCOPES)[number]["key"];

const STARTERS = [
  "Where should we cut or shift spend next month, and why?",
  "Summarize SEO progress for the partners — wins, risks, and what's next.",
  "Which practice area is producing the best marketing ROI?",
  "Give me a board slide: 3 wins, 3 risks, 3 priorities.",
];

export function CustomReport({ period }: { period: PeriodKey }) {
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null);
  const [gathering, setGathering] = useState(true);

  const [instruction, setInstruction] = useState("");
  const [scopes, setScopes] = useState<Record<ScopeKey, boolean>>({
    demand: true,
    spend: true,
    traffic: true,
    aeo: true,
    content: true,
    reputation: true,
  });

  const [result, setResult] = useState<CustomResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = useMemo(() => windowForPeriod(period), [period]);

  // Gather a compact, scope-tagged metrics bundle for the window.
  const gather = useCallback(async () => {
    setGathering(true);
    try {
      const [mRes, fRes, gRes, revRes, draftRes, kwRes, aeoRes] = await Promise.all([
        fetch(`/api/metrics/overview?since=${w.since}&until=${w.until}`, { cache: "no-store" }),
        fetch(`/api/cms/funnel-by-source?since=${w.since}&until=${w.until}`, { cache: "no-store" }),
        fetch(`/api/analytics/overview?since=${w.since}&until=${w.until}`, { cache: "no-store" }),
        fetch(`/api/reviews`, { cache: "no-store" }),
        fetch(`/api/content/drafts?limit=200`, { cache: "no-store" }),
        fetch(`/api/seo/keywords`, { cache: "no-store" }),
        fetch(`/api/aeo/dashboard`, { cache: "no-store" }),
      ]);
      const [m, f, g, rev, draft, kw, aeo] = await Promise.all([
        (mRes.ok ? mRes.json() : Promise.resolve({})) as Promise<MetricsLike>,
        (fRes.ok ? fRes.json() : Promise.resolve({})) as Promise<FunnelLike>,
        (gRes.ok ? gRes.json() : Promise.resolve({})) as Promise<Ga4Like>,
        (revRes.ok ? revRes.json() : Promise.resolve({})) as Promise<ReviewsLike>,
        (draftRes.ok ? draftRes.json() : Promise.resolve({})) as Promise<DraftsLike>,
        (kwRes.ok ? kwRes.json() : Promise.resolve({})) as Promise<KeywordsLike>,
        (aeoRes.ok ? aeoRes.json() : Promise.resolve({})) as Promise<AeoLike>,
      ]);

      const funnelRows = f.rows ?? [];
      const funnelTotals = funnelRows.reduce<{ intakes: number; matters: number; revenue: number }>(
        (a, r) => ({ intakes: a.intakes + (r.intakes ?? 0), matters: a.matters + (r.matters ?? 0), revenue: a.revenue + (r.revenue ?? 0) }),
        { intakes: 0, matters: 0, revenue: 0 },
      );

      const drafts: { format?: string; created_at?: string }[] = draft.drafts ?? [];
      const curDrafts = drafts.filter((d) => inRange(d.created_at ?? "", w.since, w.until));
      const byFormat: Record<string, number> = {};
      for (const d of curDrafts) byFormat[d.format ?? "other"] = (byFormat[d.format ?? "other"] ?? 0) + 1;

      const reviews: { rating?: number; review_date?: string }[] = rev.reviews ?? [];
      const curReviews = reviews.filter((r) => inRange(r.review_date ?? "", w.since, w.until));

      const tracked: { keyword: string; position?: number; positionDelta?: number }[] = kw.tracked ?? [];

      setBundle({
        window: { since: w.since, until: w.until, days: w.days },
        demand: { calls: m.current?.calls, answered: m.current?.answered, missed: m.current?.missed, callsDeltaPct: m.deltas?.calls?.pct, avgCoachScore: m.current?.avg_score, intakes: funnelTotals.intakes },
        spend: { spend: m.current?.spend, spendDeltaPct: m.deltas?.spend?.pct, revenue: funnelTotals.revenue, matters: funnelTotals.matters },
        traffic: { sessions: g.sessions, newUsers: g.newUsers, bounceRate: g.bounceRate },
        seo: {
          keywordGainers: tracked.filter((k) => (k.positionDelta ?? 0) > 0).sort((a, b) => (b.positionDelta ?? 0) - (a.positionDelta ?? 0)).slice(0, 6).map((k) => ({ keyword: k.keyword, to: k.position, delta: k.positionDelta })),
          keywordLosers: tracked.filter((k) => (k.positionDelta ?? 0) < 0).sort((a, b) => (a.positionDelta ?? 0) - (b.positionDelta ?? 0)).slice(0, 6).map((k) => ({ keyword: k.keyword, to: k.position, delta: k.positionDelta })),
        },
        aeo: { selfMentionRatePct: aeo.selfMentionRatePct, promptCoverage: aeo.promptCoverage },
        content: { totalCreated: curDrafts.length, byFormat },
        reputation: { newReviews: curReviews.length, avgRating: curReviews.length ? curReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / curReviews.length : null },
        channels: funnelRows.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)).slice(0, 6),
      });
    } catch {
      setBundle(null);
    } finally {
      setGathering(false);
    }
  }, [w]);

  useEffect(() => {
    void gather();
  }, [gather]);

  const generate = useCallback(
    async (prompt: string) => {
      if (!bundle) return;
      setRunning(true);
      setError(null);
      try {
        // Send only the scopes the user kept on.
        const active = SCOPES.filter((s) => scopes[s.key]).map((s) => s.key);
        const filtered: Record<string, unknown> = { window: bundle.window, channels: bundle.channels };
        const map: Record<ScopeKey, string[]> = {
          demand: ["demand"],
          spend: ["spend"],
          traffic: ["traffic", "seo"],
          aeo: ["aeo"],
          content: ["content"],
          reputation: ["reputation"],
        };
        for (const s of active) for (const k of map[s]) filtered[k] = bundle[k];

        const scopeLabel = SCOPES.filter((s) => scopes[s.key]).map((s) => s.label).join("; ");
        const res = await fetch(`/api/reporting/ai-digest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "custom",
            period: w.periodWord,
            instruction: `${prompt}\n\n(Focus areas selected by the user: ${scopeLabel || "all"}.)`,
            payload: filtered,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Generation failed (${res.status})`);
          return;
        }
        setResult(json.result as CustomResult);
      } catch (e) {
        setError((e as Error).message ?? "Generation failed");
      } finally {
        setRunning(false);
      }
    },
    [bundle, scopes, w],
  );

  return (
    <div className="space-y-5">
      {/* Builder — hidden when printing. */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Build a custom report</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Describe what you want, or pick focus areas — Claude assembles it from this {w.periodWord}'s data ({prettyDate(w.since)} – {prettyDate(w.until)}).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScopes((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                scopes[s.key] ? "border-[#4F46E5] bg-[#4F46E5]/10 text-[#4F46E5]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {scopes[s.key] ? "✓ " : ""}
              {s.label}
            </button>
          ))}
        </div>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="e.g. Write a one-page update for the partners: where we're winning, where we're losing money, and the three things to do next month."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#4F46E5] focus:outline-none"
        />

        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => setInstruction(s)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void generate(instruction || "Summarize the most important marketing results for this period.")}
            disabled={running || gathering || !bundle}
            className="rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4338CA] disabled:opacity-50"
          >
            {gathering ? "Gathering data…" : running ? "Generating…" : "Generate report"}
          </button>
          {error ? <span className="text-xs text-rose-500">{error}</span> : null}
        </div>
      </div>

      {running && !result ? (
        <p className="text-sm text-slate-500">Claude is assembling your report…</p>
      ) : result ? (
        <ReportFrame
          title={result.title || "Custom Report"}
          periodLabel={`${prettyDate(w.since)} – ${prettyDate(w.until)} (${w.days} days)`}
          footer="AI-generated from MarketOS metrics for the selected window and focus areas. Verify figures against the underlying dashboards before circulating externally."
        >
          <div className="rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">{result.summary}</div>
          {result.sections?.map((sec, i) => (
            <Section key={i} num={i + 1} title={sec.heading}>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {sec.bullets?.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </Section>
          ))}
        </ReportFrame>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          Your generated report will appear here.
        </div>
      )}
    </div>
  );
}
