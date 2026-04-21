import type { Metadata } from "next";
import Link from "next/link";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Opportunities | Katz Melinger PLLC",
  description: "Actionable SEO opportunities from keyword, backlink, and competitor gap analysis.",
};

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

type Props = {
  searchParams: Promise<{ competitor?: string }>;
};

export default async function SeoOpportunitiesPage(props: Props) {
  const searchParams = await props.searchParams;
  const base = await getRequestOrigin();
  const query = searchParams.competitor
    ? `?competitor=${encodeURIComponent(searchParams.competitor)}`
    : "";
  const res = await fetch(`${base}/api/seo/opportunities${query}`, { cache: "no-store" });
  const data = (await res.json()) as OpportunitiesResponse;

  return (
    <SeoShell
      title="SEO Opportunity Radar"
      subtitle="Prioritized keyword and backlink opportunities based on competitor gaps and legal search demand."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Selected competitor</p>
          <p className="mt-2 text-lg font-semibold">{data.selectedCompetitor || "—"}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Keyword quick wins</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.summary?.keywordQuickWins ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Missing target terms</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.missingTargetKeywords?.length ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Toxic links to review</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.summary?.toxicLinksToDisavow ?? 0)}</p>
        </article>
      </section>

      <section className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
        <h2 className="text-lg font-semibold">Competitor selector</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data.competitors ?? []).map((domain) => (
            <Link
              key={domain}
              href={`/seo/opportunities?competitor=${encodeURIComponent(domain)}`}
              className="rounded border border-[#2a3f5f] bg-[#0f1729] px-3 py-1 text-xs text-slate-200 hover:border-[#185FA5] hover:text-white"
            >
              {domain}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Keyword quick wins</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[#2a3f5f] text-slate-400">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Keyword</th>
                  <th className="pb-2 pr-3 font-medium">Their pos</th>
                  <th className="pb-2 pr-3 font-medium">Our pos</th>
                  <th className="pb-2 font-medium">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {(data.quickWins ?? []).map((row) => (
                  <tr key={row.keyword} className="border-b border-[#2a3f5f]/60 last:border-0">
                    <td className="py-2 pr-3 text-white">{row.keyword}</td>
                    <td className="py-2 pr-3">{row.competitorPosition}</td>
                    <td className="py-2 pr-3">{row.ourPosition || "Not ranking"}</td>
                    <td className="py-2">{row.opportunityScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Content and link opportunities</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {(data.longTailSuggestions ?? []).map((keyword) => (
              <li key={keyword} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                Content idea: {keyword}
              </li>
            ))}
            {(data.topLinkGaps ?? []).map((item) => (
              <li key={item.domain} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                Link target: {item.domain} - {item.opportunity}
              </li>
            ))}
          </ul>
        </article>
      </section>
    </SeoShell>
  );
}

