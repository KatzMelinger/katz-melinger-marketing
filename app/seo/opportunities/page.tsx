"use client";

/**
 * SEO Opportunity Radar.
 *
 * Surfaces keyword quick wins (competitor outranks us), missing target
 * keywords, long-tail content ideas, and link-building gaps. Each
 * keyword/idea row has the same Ideas + Create actions as /seo/keywords.
 *
 * Converted from a server component so the Ideas + Create modal/toast
 * can live alongside the rendered rows.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ContentActionsRow, useContentActions } from "@/components/content-actions";
import { formatNumber, SeoShell } from "@/components/seo-shell";

type OpportunitiesResponse = {
  selectedCompetitor?: string;
  competitors?: string[];
  quickWins?: Array<{
    keyword: string;
    opportunityScore: number;
    competitorPosition: number;
    ourPosition: number;
  }>;
  missingTargetKeywords?: string[];
  longTailSuggestions?: string[];
  topLinkGaps?: Array<{ domain: string; opportunity: string }>;
  summary?: { keywordQuickWins: number; toxicLinksToDisavow: number };
};

export default function SeoOpportunitiesPage() {
  const searchParams = useSearchParams();
  const competitor = searchParams?.get("competitor") ?? "";

  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const ca = useContentActions();

  useEffect(() => {
    setLoading(true);
    const query = competitor ? `?competitor=${encodeURIComponent(competitor)}` : "";
    fetch(`/api/seo/opportunities${query}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d as OpportunitiesResponse))
      .finally(() => setLoading(false));
  }, [competitor]);

  return (
    <SeoShell
      title="SEO Opportunity Radar"
      subtitle="Prioritized keyword and backlink opportunities based on competitor gaps and legal search demand."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Selected competitor</p>
          <p className="mt-2 text-lg font-semibold">{data?.selectedCompetitor || "—"}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Keyword quick wins</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.summary?.keywordQuickWins ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing target terms</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.missingTargetKeywords?.length ?? 0)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Toxic links to review</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(data?.summary?.toxicLinksToDisavow ?? 0)}
          </p>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Competitor selector</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data?.competitors ?? []).map((domain) => (
            <Link
              key={domain}
              href={`/seo/opportunities?competitor=${encodeURIComponent(domain)}`}
              className="rounded border border-[#e2e8f0] bg-[#ffffff] px-3 py-1 text-xs text-slate-700 hover:border-[#185FA5] hover:text-slate-900"
            >
              {domain}
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Keyword quick wins</h2>
        <p className="mt-1 text-xs text-slate-500">
          Keywords where the competitor outranks us. Click <b>Ideas</b> for AI angles or{" "}
          <b>Create</b> for a draft optimized for that keyword.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500 text-xs">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Their pos</th>
                <th className="pb-2 pr-3 font-medium">Our pos</th>
                <th className="pb-2 pr-3 font-medium">Opportunity</th>
                <th className="pb-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    Loading opportunities…
                  </td>
                </tr>
              )}
              {!loading && (data?.quickWins ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No quick wins for this competitor.
                  </td>
                </tr>
              )}
              {(data?.quickWins ?? []).map((row) => (
                <tr
                  key={row.keyword}
                  className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0 hover:bg-slate-50"
                >
                  <td className="py-2 pr-3 text-slate-900">{row.keyword}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.competitorPosition}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {row.ourPosition || "Not ranking"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{row.opportunityScore}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <ContentActionsRow keyword={row.keyword} actions={ca} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Missing target keywords</h2>
          <p className="mt-1 text-xs text-slate-500">
            Tracked targets the firm doesn't rank for yet.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.missingTargetKeywords ?? []).length === 0 && !loading && (
              <li className="text-xs text-slate-400">All targets ranking.</li>
            )}
            {(data?.missingTargetKeywords ?? []).map((kw) => (
              <li
                key={kw}
                className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2"
              >
                <span className="text-slate-900">{kw}</span>
                <ContentActionsRow keyword={kw} actions={ca} />
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Long-tail content ideas</h2>
          <p className="mt-1 text-xs text-slate-500">
            Suggested long-tail variations to capture additional search demand.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.longTailSuggestions ?? []).length === 0 && !loading && (
              <li className="text-xs text-slate-400">No suggestions returned.</li>
            )}
            {(data?.longTailSuggestions ?? []).map((kw) => (
              <li
                key={kw}
                className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2"
              >
                <span className="text-slate-700">{kw}</span>
                <ContentActionsRow keyword={kw} actions={ca} />
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Link-building opportunities</h2>
        <p className="mt-1 text-xs text-slate-500">
          Domains worth pursuing for backlinks. (Ideas/Create don't apply — these are outreach
          targets, not content ideas.)
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {(data?.topLinkGaps ?? []).map((item) => (
            <li key={item.domain} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
              <p className="font-medium text-slate-900">{item.domain}</p>
              <p className="text-xs text-slate-500">{item.opportunity}</p>
            </li>
          ))}
        </ul>
      </section>

      {ca.modal}
    </SeoShell>
  );
}
