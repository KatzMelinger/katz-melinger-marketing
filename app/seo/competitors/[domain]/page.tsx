import type { Metadata } from "next";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Competitor Detail | Katz Melinger PLLC",
  description: "Detailed competitor SEO intelligence.",
};

type CompetitorDetailResponse = {
  domain?: string;
  keywordCount?: number;
  topKeywords?: Array<{ keyword: string; position: number; searchVolume: number }>;
  keywordGaps?: Array<{ keyword: string; ourPosition: number; competitorPosition: number; opportunityScore: number }>;
  backlinkOverview?: { authorityScore: number; totalBacklinks: number; referringDomains: number };
  contentCadenceEstimatePerMonth?: number;
  serpFeatureCaptureRate?: number;
  marketShareEstimate?: number;
  backlinkAcquisitionAlerts?: string[];
  contentCalendarInsights?: { postingFrequencyPerMonth?: number; dominantTopics?: string[] };
};

type Props = {
  params: Promise<{ domain: string }>;
};

export default async function CompetitorDetailPage({ params }: Props) {
  const { domain } = await params;
  const decoded = decodeURIComponent(domain);
  const base = await getRequestOrigin();
  const res = await fetch(`${base}/api/seo/competitors/${encodeURIComponent(decoded)}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as CompetitorDetailResponse;

  return (
    <SeoShell
      title={`Competitor Intelligence: ${decoded}`}
      subtitle="Keyword, backlink, SERP, and publishing-strategy benchmark against your legal market competitor."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Ranking keywords</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.keywordCount ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Authority score</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.backlinkOverview?.authorityScore ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Content cadence / month</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.contentCadenceEstimatePerMonth ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">SERP feature capture</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.serpFeatureCaptureRate ?? 0)}%</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Legal market share</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.marketShareEstimate ?? 0)}%</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Top ranking keywords</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.topKeywords ?? []).slice(0, 15).map((item) => (
              <li key={item.keyword} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <p className="text-white">{item.keyword}</p>
                <p className="text-xs text-slate-400">
                  Position {item.position} · Volume {formatNumber(item.searchVolume)}
                </p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Keyword gaps vs our domain</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[#2a3f5f] text-slate-400">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Keyword</th>
                  <th className="pb-2 pr-3 font-medium">Their Pos</th>
                  <th className="pb-2 pr-3 font-medium">Our Pos</th>
                  <th className="pb-2 font-medium">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {(data.keywordGaps ?? []).slice(0, 20).map((item) => (
                  <tr key={item.keyword} className="border-b border-[#2a3f5f]/60 last:border-0">
                    <td className="py-2 pr-3 text-white">{item.keyword}</td>
                    <td className="py-2 pr-3">{item.competitorPosition}</td>
                    <td className="py-2 pr-3">{item.ourPosition || "Not ranking"}</td>
                    <td className="py-2">{item.opportunityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
        <h2 className="text-lg font-semibold">Backlink acquisition alerts</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-200">
          {(data.backlinkAcquisitionAlerts ?? []).map((alert) => (
            <li key={alert} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
              {alert}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Estimated posting frequency: {formatNumber(data.contentCalendarInsights?.postingFrequencyPerMonth ?? 0)} content pieces/month.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Dominant topics: {(data.contentCalendarInsights?.dominantTopics ?? []).join(", ") || "—"}
        </p>
      </section>
    </SeoShell>
  );
}

