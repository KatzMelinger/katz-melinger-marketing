import type { Metadata } from "next";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin, serverFetch } from "@/lib/request-origin";
import { APP_NAME } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Competitor Detail | ${APP_NAME}`,
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
  const res = await serverFetch(
    `${base}/api/seo/competitors/${encodeURIComponent(decoded)}`,
  );
  const data = (await res.json()) as CompetitorDetailResponse;

  return (
    <SeoShell
      title={`Competitor Intelligence: ${decoded}`}
      subtitle="Keyword, backlink, SERP, and publishing-strategy benchmark against your legal market competitor."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Ranking keywords</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.keywordCount ?? 0)}</p>
        </article>
        <article
          className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4"
          title="Relative trend, not an absolute number. Authority is derived from DataForSEO's domain rank and is most useful watched over time and compared against competitors."
        >
          <p className="text-xs uppercase tracking-wide text-slate-500">Authority</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.backlinkOverview?.authorityScore ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Content cadence / month</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.contentCadenceEstimatePerMonth ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">SERP feature capture</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.serpFeatureCaptureRate ?? 0)}%</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Legal market share</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.marketShareEstimate ?? 0)}%</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Top ranking keywords</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.topKeywords ?? []).slice(0, 15).map((item) => (
              <li key={item.keyword} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
                <p className="text-slate-900">{item.keyword}</p>
                <p className="text-xs text-slate-500">
                  Position {item.position} · Volume {formatNumber(item.searchVolume)}
                </p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Keyword gaps vs our domain</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[#e2e8f0] text-slate-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Keyword</th>
                  <th className="pb-2 pr-3 font-medium">Their Pos</th>
                  <th className="pb-2 pr-3 font-medium">Our Pos</th>
                  <th className="pb-2 font-medium">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {(data.keywordGaps ?? []).slice(0, 20).map((item) => (
                  <tr key={item.keyword} className="border-b border-[#e2e8f0]/60 last:border-0">
                    <td className="py-2 pr-3 text-slate-900">{item.keyword}</td>
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

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Backlink acquisition alerts</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {(data.backlinkAcquisitionAlerts ?? []).map((alert) => (
            <li key={alert} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
              {alert}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Estimated posting frequency: {formatNumber(data.contentCalendarInsights?.postingFrequencyPerMonth ?? 0)} content pieces/month.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Dominant topics: {(data.contentCalendarInsights?.dominantTopics ?? []).join(", ") || "—"}
        </p>
      </section>
    </SeoShell>
  );
}

