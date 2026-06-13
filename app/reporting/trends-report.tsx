"use client";

/**
 * Trends report — the biggest wins and risks across SEO, AEO and organic
 * search, with Claude picking and ranking what actually matters for the
 * cadence. We gather the raw movers client-side (keyword position deltas, GSC
 * click swings, AEO share-of-voice) and POST them to /api/reporting/ai-digest,
 * which returns a ranked, plain-English digest a partner can skim.
 *
 * Note on windows: keyword deltas come from the latest SEO refresh and GSC is a
 * trailing-28-day API, so movement is "since the last refresh", not a strict
 * calendar week/month — the cadence tunes the AI's framing and emphasis.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fmtNum, fmtPct, type PeriodKey, ReportFrame, Section, windowForPeriod } from "@/app/reporting/report-ui";

type TrackedKw = { keyword: string; position?: number; previousPosition?: number; positionDelta?: number; searchVolume?: number; url?: string };
type KeywordsResponse = { tracked?: TrackedKw[]; trendingKeywords?: { keyword: string; searchVolume: number; trendScore?: number }[] };
type GscKw = { query: string; clicks: number; impressions: number; ctr: number; position: number };
type GscDay = { date: string; clicks: number; impressions: number };
type AeoBrand = { name: string; type?: "self" | "competitor"; mentionRatePct?: number; answers?: number };
type AeoDashboard = {
  selfMentionRatePct?: number;
  promptCoverage?: { total: number; covered: number; pct: number };
  shareOfVoiceOverall?: AeoBrand[];
  sentimentDistribution?: { positive: number; neutral: number; negative: number; mixed: number; none: number };
  runDate?: string | null;
};
type AeoRun = { id: string; status: string; response_count?: number; completed_at?: string | null };

type Highlight = { label: string; direction: "good" | "bad" | "neutral"; metric?: string; detail: string };
type TrendsResult = { headline: string; narrative: string; highlights: Highlight[] };

export function TrendsReport({ period }: { period: PeriodKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedKw[]>([]);
  const [gscKw, setGscKw] = useState<GscKw[]>([]);
  const [gscDays, setGscDays] = useState<GscDay[]>([]);
  const [aeo, setAeo] = useState<AeoDashboard | null>(null);
  const [runs, setRuns] = useState<AeoRun[]>([]);

  const [digest, setDigest] = useState<TrendsResult | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  const w = useMemo(() => windowForPeriod(period), [period]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kwRes, gscKwRes, gscDayRes, aeoRes, runsRes] = await Promise.all([
        fetch(`/api/seo/keywords`, { cache: "no-store" }),
        fetch(`/api/search-console/keywords`, { cache: "no-store" }),
        fetch(`/api/search-console/by-day`, { cache: "no-store" }),
        fetch(`/api/aeo/dashboard`, { cache: "no-store" }),
        fetch(`/api/aeo/runs`, { cache: "no-store" }),
      ]);
      const [kw, gk, gd, ae, rn] = await Promise.all([
        kwRes.ok ? (kwRes.json() as Promise<KeywordsResponse>) : Promise.resolve({} as KeywordsResponse),
        gscKwRes.ok ? (gscKwRes.json() as Promise<{ keywords?: GscKw[] }>) : Promise.resolve({} as { keywords?: GscKw[] }),
        gscDayRes.ok ? (gscDayRes.json() as Promise<{ days?: GscDay[] }>) : Promise.resolve({} as { days?: GscDay[] }),
        aeoRes.ok ? (aeoRes.json() as Promise<AeoDashboard>) : Promise.resolve({} as AeoDashboard),
        runsRes.ok ? (runsRes.json() as Promise<{ runs?: AeoRun[] }>) : Promise.resolve({} as { runs?: AeoRun[] }),
      ]);
      setTracked(kw.tracked ?? []);
      setGscKw(gk.keywords ?? []);
      setGscDays(gd.days ?? []);
      setAeo(ae ?? null);
      setRuns(rn.runs ?? []);
    } catch (e) {
      setError((e as Error).message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const movers = useMemo(() => {
    const withDelta = tracked.filter((k) => typeof k.positionDelta === "number" && k.positionDelta !== 0);
    const gainers = withDelta.filter((k) => (k.positionDelta ?? 0) > 0).sort((a, b) => (b.positionDelta ?? 0) - (a.positionDelta ?? 0)).slice(0, 8);
    const losers = withDelta.filter((k) => (k.positionDelta ?? 0) < 0).sort((a, b) => (a.positionDelta ?? 0) - (b.positionDelta ?? 0)).slice(0, 8);
    return { gainers, losers };
  }, [tracked]);

  // GSC click swing: the selected window's most-recent N days vs the prior N
  // days, drawn from Search Console's trailing 28-day series.
  const gscTrend = useMemo(() => {
    if (!gscDays.length) return null;
    const n = w.days;
    const last = gscDays.slice(-n);
    const first = gscDays.slice(Math.max(0, gscDays.length - 2 * n), gscDays.length - n);
    if (!last.length) return null;
    const sum = (rows: GscDay[], key: "clicks" | "impressions") => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
    const recentClicks = sum(last, "clicks");
    const priorClicks = sum(first, "clicks");
    const recentImpr = sum(last, "impressions");
    const priorImpr = sum(first, "impressions");
    return {
      recentClicks,
      priorClicks,
      clicksPct: priorClicks > 0 ? Math.round(((recentClicks - priorClicks) / priorClicks) * 1000) / 10 : null,
      recentImpr,
      priorImpr,
      imprPct: priorImpr > 0 ? Math.round(((recentImpr - priorImpr) / priorImpr) * 1000) / 10 : null,
    };
  }, [gscDays, w]);

  const aeoTrend = useMemo(() => {
    const done = runs.filter((r) => r.status === "done");
    if (done.length < 2) return null;
    const [latest, prior] = done;
    return { latestResp: latest.response_count ?? 0, priorResp: prior.response_count ?? 0 };
  }, [runs]);

  const selfBrand = useMemo(() => (aeo?.shareOfVoiceOverall ?? []).find((b) => b.type === "self"), [aeo]);
  const topCompetitors = useMemo(
    () => (aeo?.shareOfVoiceOverall ?? []).filter((b) => b.type === "competitor").slice(0, 4),
    [aeo],
  );

  const runDigest = useCallback(async () => {
    setDigestLoading(true);
    setDigestError(null);
    try {
      const payload = {
        period: w.periodWord,
        keywordGainers: movers.gainers.map((k) => ({ keyword: k.keyword, from: k.previousPosition, to: k.position, delta: k.positionDelta, volume: k.searchVolume })),
        keywordLosers: movers.losers.map((k) => ({ keyword: k.keyword, from: k.previousPosition, to: k.position, delta: k.positionDelta, volume: k.searchVolume })),
        organicSearch: gscTrend,
        gscTopKeywords: gscKw.slice(0, 15).map((k) => ({ query: k.query, clicks: k.clicks, impressions: k.impressions, position: Math.round(k.position * 10) / 10 })),
        aeo: {
          selfMentionRatePct: aeo?.selfMentionRatePct,
          promptCoverage: aeo?.promptCoverage,
          self: selfBrand,
          competitors: topCompetitors,
          sentiment: aeo?.sentimentDistribution,
          runTrend: aeoTrend,
        },
      };
      const res = await fetch(`/api/reporting/ai-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "trends", period: w.periodWord, payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDigestError(json.error ?? `AI digest failed (${res.status})`);
        return;
      }
      setDigest(json.result as TrendsResult);
    } catch (e) {
      setDigestError((e as Error).message ?? "AI digest failed");
    } finally {
      setDigestLoading(false);
    }
  }, [w, movers, gscTrend, gscKw, aeo, selfBrand, topCompetitors, aeoTrend]);

  // Auto-run the digest once the underlying data has loaded (or period changes).
  const hasData = !loading && (tracked.length > 0 || gscDays.length > 0 || aeo != null);
  useEffect(() => {
    if (hasData) void runDigest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, period]);

  if (loading) return <p className="text-slate-500">Gathering trend data…</p>;
  if (error) return <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{error}</div>;

  const toneClass = (d: Highlight["direction"]) =>
    d === "good" ? "border-emerald-200 bg-emerald-50" : d === "bad" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50";
  const toneDot = (d: Highlight["direction"]) =>
    d === "good" ? "bg-emerald-500" : d === "bad" ? "bg-rose-500" : "bg-slate-400";

  return (
    <ReportFrame
      title={`Trends Digest — ${w.label}`}
      periodLabel="What moved across SEO, AI search (AEO) and organic — ranked by impact."
      footer="Keyword movement comes from the latest SEO rank refresh; organic clicks compare the recent vs earlier half of Search Console's trailing 28-day window; AI visibility reflects the most recent AEO run. The digest is AI-generated from these figures."
    >
      {/* 1 — AI-picked highlights */}
      <Section num={1} title="What mattered this period" blurb="Claude ranked the wins and risks below by business impact.">
        <div className="mb-3 flex items-center gap-3 print:hidden">
          <button
            onClick={() => void runDigest()}
            disabled={digestLoading}
            className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {digestLoading ? "Analyzing…" : digest ? "↻ Regenerate" : "Generate digest"}
          </button>
          {digestError ? <span className="text-xs text-rose-500">{digestError}</span> : null}
        </div>
        {digestLoading && !digest ? (
          <p className="text-sm text-slate-500">Claude is reviewing the movers…</p>
        ) : digest ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-base font-semibold text-slate-900">{digest.headline}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{digest.narrative}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {digest.highlights?.map((h, i) => (
                <div key={i} className={`rounded-lg border p-3 ${toneClass(h.direction)}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${toneDot(h.direction)}`} />
                    <p className="text-sm font-semibold text-slate-900">{h.label}</p>
                    {h.metric ? <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">{h.metric}</span> : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{h.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No digest yet — click “Generate digest”.</p>
        )}
      </Section>

      {/* 2 — Keyword movers */}
      <Section num={2} title="Keyword movers" blurb="Largest ranking gains and drops since the last SEO refresh.">
        <div className="grid gap-4 lg:grid-cols-2">
          <MoverTable title="Biggest gains" rows={movers.gainers} good />
          <MoverTable title="Biggest drops" rows={movers.losers} good={false} />
        </div>
        {!movers.gainers.length && !movers.losers.length ? (
          <p className="text-sm text-slate-500">
            No ranking changes available. Track keywords on the{" "}
            <Link href="/seo/keywords" className="text-[#4F46E5] hover:underline print:no-underline">Keyword Tracker</Link>.
          </p>
        ) : null}
      </Section>

      {/* 3 — Organic search */}
      <Section num={3} title="Organic search" blurb="Google Search Console — recent half vs earlier half of the trailing 28 days.">
        {gscTrend ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Clicks</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{fmtNum(gscTrend.recentClicks)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {gscTrend.clicksPct == null ? "no prior" : <span className={gscTrend.clicksPct >= 0 ? "text-emerald-600" : "text-rose-500"}>{gscTrend.clicksPct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(gscTrend.clicksPct), 1)}</span>} vs prior {fmtNum(gscTrend.priorClicks)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Impressions</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{fmtNum(gscTrend.recentImpr)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {gscTrend.imprPct == null ? "no prior" : <span className={gscTrend.imprPct >= 0 ? "text-emerald-600" : "text-rose-500"}>{gscTrend.imprPct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(gscTrend.imprPct), 1)}</span>} vs prior {fmtNum(gscTrend.priorImpr)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No Search Console data available.</p>
        )}
      </Section>

      {/* 4 — AI visibility (AEO) */}
      <Section num={4} title="AI search visibility (AEO)" blurb="How often the firm shows up in AI assistant answers, and who's beating us.">
        {aeo && (aeo.selfMentionRatePct != null || aeo.promptCoverage) ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Self-mention rate</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{aeo.selfMentionRatePct != null ? fmtPct(aeo.selfMentionRatePct) : "—"}</p>
                <p className="mt-1 text-[11px] text-slate-400">of AI answers mention the firm</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Prompt coverage</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{aeo.promptCoverage ? fmtPct(aeo.promptCoverage.pct) : "—"}</p>
                <p className="mt-1 text-[11px] text-slate-400">{aeo.promptCoverage ? `${aeo.promptCoverage.covered}/${aeo.promptCoverage.total} prompts` : ""}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sentiment</p>
                <p className="mt-1 text-sm text-slate-700">
                  {aeo.sentimentDistribution ? (
                    <>
                      <span className="text-emerald-600">{aeo.sentimentDistribution.positive}+</span>{" / "}
                      <span className="text-slate-500">{aeo.sentimentDistribution.neutral}○</span>{" / "}
                      <span className="text-rose-500">{aeo.sentimentDistribution.negative}−</span>
                    </>
                  ) : (
                    "—"
                  )}
                </p>
              </div>
            </div>
            {topCompetitors.length ? (
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Share of voice — top competitors in AI answers</p>
                <div className="space-y-1.5">
                  {selfBrand ? (
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-[#4F46E5]">{selfBrand.name} (us)</span>
                      <span className="tabular-nums text-slate-600">{selfBrand.mentionRatePct != null ? fmtPct(selfBrand.mentionRatePct) : fmtNum(selfBrand.answers ?? 0)}</span>
                    </div>
                  ) : null}
                  {topCompetitors.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{c.name}</span>
                      <span className="tabular-nums text-slate-500">{c.mentionRatePct != null ? fmtPct(c.mentionRatePct) : fmtNum(c.answers ?? 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No AEO run data yet. Run a scan from the{" "}
            <Link href="/aeo" className="text-[#4F46E5] hover:underline print:no-underline">AEO dashboard</Link>.
          </p>
        )}
      </Section>
    </ReportFrame>
  );
}

function MoverTable({ title, rows, good }: { title: string; rows: TrackedKw[]; good: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200">
      <div className={`border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${good ? "text-emerald-700" : "text-rose-600"}`}>
        {good ? "▲ " : "▼ "}
        {title}
      </div>
      {rows.length ? (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((k) => (
              <tr key={k.keyword}>
                <td className="px-3 py-2 text-slate-800">
                  <span className="line-clamp-1" title={k.keyword}>{k.keyword}</span>
                  {k.searchVolume ? <span className="text-[11px] text-slate-400">{fmtNum(k.searchVolume)}/mo</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {k.previousPosition ?? "—"} → <span className="font-semibold text-slate-900">{k.position ?? "—"}</span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${good ? "text-emerald-600" : "text-rose-500"}`}>
                  {good ? "▲" : "▼"} {Math.abs(k.positionDelta ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-3 py-4 text-sm text-slate-400">None this period.</p>
      )}
    </div>
  );
}
