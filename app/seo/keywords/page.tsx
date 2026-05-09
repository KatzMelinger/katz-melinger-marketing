import type { Metadata } from "next";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Keywords | Katz Melinger PLLC",
  description: "Track target keywords, gaps, trends, and long-tail opportunities.",
};

type KeywordResponse = {
  tracked?: Array<{
    keyword: string;
    position: number;
    searchVolume: number;
    keywordDifficulty: number;
    trendScore: number;
    estimatedTraffic: number;
  }>;
  missingTargets?: string[];
  trendingKeywords?: Array<{ keyword: string; searchVolume: number; trendScore: number }>;
  longTailSuggestions?: string[];
  competitive?: Array<{
    keyword: string;
    competitorPosition: number;
    ourPosition: number;
    opportunityScore: number;
    domain: string;
  }>;
};

export default async function SeoKeywordsPage() {
  const base = await getRequestOrigin();
  const [trackedRes, competitiveRes] = await Promise.all([
    fetch(`${base}/api/seo/keywords`, { cache: "no-store" }),
    fetch(`${base}/api/seo/keywords?competitor=nilawfirm.com`, { cache: "no-store" }),
  ]);
  const data = (await trackedRes.json()) as KeywordResponse;
  const competitive = (await competitiveRes.json()) as KeywordResponse;

  return (
    <SeoShell
      title="Keyword Tracking & Research"
      subtitle="Target keyword rankings, difficulty analysis, legal trend discovery, and competitor opportunity gaps."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Target keywords</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.tracked?.length ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Ranking in top 10</p>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber((data.tracked ?? []).filter((item) => item.position > 0 && item.position <= 10).length)}
          </p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing targets</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.missingTargets?.length ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Trend keywords</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.trendingKeywords?.length ?? 0)}</p>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Target keyword tracker</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Position</th>
                <th className="pb-2 pr-3 font-medium">Volume</th>
                <th className="pb-2 pr-3 font-medium">KD</th>
                <th className="pb-2 pr-3 font-medium">Trend</th>
                <th className="pb-2 font-medium">Est. Traffic</th>
              </tr>
            </thead>
            <tbody>
              {(data.tracked ?? []).map((item) => (
                <tr key={item.keyword} className="border-b border-[#e2e8f0]/60 text-slate-700 last:border-0">
                  <td className="py-2 pr-3 text-slate-900">{item.keyword}</td>
                  <td className="py-2 pr-3">{item.position > 0 ? item.position : "Not ranking"}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(item.searchVolume)}</td>
                  <td className="py-2 pr-3 tabular-nums">{item.keywordDifficulty || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{item.trendScore || "—"}</td>
                  <td className="py-2 tabular-nums">{formatNumber(item.estimatedTraffic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Legal industry trends</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.trendingKeywords ?? []).map((item) => (
              <li key={item.keyword} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
                <p className="text-slate-900">{item.keyword}</p>
                <p className="text-xs text-slate-500">
                  Volume {formatNumber(item.searchVolume)} · Trend {item.trendScore}
                </p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold">Long-tail opportunities</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {(data.longTailSuggestions ?? []).map((keyword) => (
              <li key={keyword} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
                {keyword}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold">Competitor keyword opportunities</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-[#e2e8f0] text-slate-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Competitor Pos</th>
                <th className="pb-2 pr-3 font-medium">Our Pos</th>
                <th className="pb-2 pr-3 font-medium">Opportunity</th>
                <th className="pb-2 font-medium">Domain</th>
              </tr>
            </thead>
            <tbody>
              {(competitive.competitive ?? []).slice(0, 20).map((item) => (
                <tr key={`${item.domain}-${item.keyword}`} className="border-b border-[#e2e8f0]/60 last:border-0">
                  <td className="py-2 pr-3 text-slate-900">{item.keyword}</td>
                  <td className="py-2 pr-3">{item.competitorPosition}</td>
                  <td className="py-2 pr-3">{item.ourPosition || "Not ranking"}</td>
                  <td className="py-2 pr-3">{item.opportunityScore}</td>
                  <td className="py-2 text-slate-600">{item.domain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SeoShell>
  );
}

