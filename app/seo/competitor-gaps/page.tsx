"use client";

/**
 * Competitor Gaps page.
 *
 * Surfaces keywords your tracked competitors rank for that you don't (or rank
 * worse on), sorted by opportunity. Reads from /api/seo/competitor-gaps, which
 * runs the existing getKeywordGapVsCompetitors() analysis over every domain on
 * /seo/competitors. Each row links into keyword research so a gap can be turned
 * into a brief.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { SeoShell, formatNumber } from "@/components/seo-shell";

type Gap = {
  keyword: string;
  ourPosition: number;
  competitorPosition: number;
  searchVolume: number;
  opportunityScore: number;
  domain: string;
  competitorsBeatingUs: number;
};

type Payload = {
  competitors: string[];
  gaps: Gap[];
};

function positionLabel(pos: number): string {
  return pos > 0 ? `#${pos}` : "—";
}

function scoreClasses(score: number): string {
  if (score >= 70) return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (score >= 40) return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-slate-300 bg-slate-50 text-slate-600";
}

export default function CompetitorGapsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seo/competitor-gaps", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Failed");
        return;
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const gaps = data?.gaps ?? [];
  const quickWins = useMemo(
    () => gaps.filter((g) => g.ourPosition === 0 && g.opportunityScore >= 60).length,
    [gaps],
  );
  const totalVolume = useMemo(
    () => gaps.reduce((sum, g) => sum + (g.searchVolume || 0), 0),
    [gaps],
  );

  return (
    <SeoShell
      title="Competitor Gaps"
      subtitle="Keywords your tracked competitors rank for that you don't — sorted by opportunity. Turn the best into briefs."
    >
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-4">
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Gap keywords</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(gaps.length)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Quick wins</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(quickWins)}</p>
          <p className="mt-1 text-[11px] text-slate-500">Not ranking · high opportunity</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total search volume</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(totalVolume)}</p>
          <p className="mt-1 text-[11px] text-slate-500">Monthly, across all gaps</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Competitors compared</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data?.competitors.length ?? 0)}</p>
          <Link href="/seo/competitors" className="mt-1 inline-block text-[11px] text-brand hover:underline">
            Manage competitors →
          </Link>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Keyword gaps</h2>
            <p className="mt-1 text-xs text-slate-500">
              Opportunity blends search volume, how far ahead the competitor ranks, and how many
              competitors beat you. Higher is better.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-md border border-brand px-3 py-2 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {loading && !data && <p className="mt-4 text-sm text-slate-500">Loading gap analysis…</p>}

        {data && data.competitors.length === 0 && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            No competitors tracked yet. Add some on{" "}
            <Link href="/seo/competitors" className="font-medium underline">
              Competitors
            </Link>{" "}
            and they&apos;ll be compared here.
          </div>
        )}

        {data && data.competitors.length > 0 && gaps.length === 0 && !loading && (
          <p className="mt-4 text-sm text-slate-500">
            No gaps found — you rank at least as well as your competitors on the keywords analyzed.
          </p>
        )}

        {gaps.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Keyword</th>
                  <th className="px-2 py-2 font-medium text-right">Volume</th>
                  <th className="px-2 py-2 font-medium text-center">You</th>
                  <th className="px-2 py-2 font-medium text-center">Best competitor</th>
                  <th className="px-2 py-2 font-medium">Leading domain</th>
                  <th className="px-2 py-2 font-medium text-center">Opportunity</th>
                  <th className="px-2 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.keyword} className="border-b border-[#f1f5f9] hover:bg-slate-50">
                    <td className="px-2 py-2 font-medium text-slate-900">{g.keyword}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(g.searchVolume)}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-500">
                      {positionLabel(g.ourPosition)}
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums font-medium">
                      {positionLabel(g.competitorPosition)}
                    </td>
                    <td className="px-2 py-2 text-slate-600">
                      {g.domain}
                      {g.competitorsBeatingUs > 1 && (
                        <span className="ml-1 text-[11px] text-slate-400">
                          +{g.competitorsBeatingUs - 1} more
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreClasses(
                          g.opportunityScore,
                        )}`}
                      >
                        {Math.round(g.opportunityScore)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/keyword-research?seed=${encodeURIComponent(g.keyword)}`}
                          className="text-xs text-brand hover:underline"
                        >
                          Research →
                        </Link>
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(g.keyword)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-slate-500 hover:underline"
                        >
                          SERP
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SeoShell>
  );
}
