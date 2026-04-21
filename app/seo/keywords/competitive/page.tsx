import type { Metadata } from "next";
import Link from "next/link";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Keyword Battles | Katz Melinger PLLC",
  description: "Head-to-head keyword rankings against selected competitors.",
};

type PageProps = {
  searchParams: Promise<{ domain?: string }>;
};

type CompetitiveResponse = {
  competitor?: string;
  opportunities?: Array<{
    keyword: string;
    competitorPosition: number;
    ourPosition: number;
    opportunityScore: number;
    searchVolume: number;
  }>;
};

type CompetitorsListResponse = {
  trackedDomains?: string[];
};

export default async function KeywordCompetitivePage(props: PageProps) {
  const searchParams = await props.searchParams;
  const base = await getRequestOrigin();
  const competitorsRes = await fetch(`${base}/api/seo/competitors`, { cache: "no-store" });
  const competitors = (await competitorsRes.json()) as CompetitorsListResponse;
  const selected = searchParams.domain || competitors.trackedDomains?.[0] || "";
  const dataRes = selected
    ? await fetch(`${base}/api/seo/keywords/competitive?domain=${encodeURIComponent(selected)}`, {
        cache: "no-store",
      })
    : null;
  const data = (dataRes ? await dataRes.json() : {}) as CompetitiveResponse;

  return (
    <SeoShell
      title="Keyword Battles"
      subtitle="Compare target rankings against specific law firm competitors and prioritize high-impact gaps."
    >
      <section className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
        <h2 className="text-lg font-semibold">Choose competitor</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(competitors.trackedDomains ?? []).map((domain) => (
            <Link
              key={domain}
              href={`/seo/keywords/competitive?domain=${encodeURIComponent(domain)}`}
              className={`rounded border px-3 py-1 text-xs ${
                selected === domain
                  ? "border-[#185FA5] bg-[#185FA5] text-white"
                  : "border-[#2a3f5f] bg-[#0f1729] text-slate-200"
              }`}
            >
              {domain}
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
        <h2 className="text-lg font-semibold">Head-to-head rankings: {data.competitor || selected || "—"}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-[#2a3f5f] text-slate-400">
              <tr>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">Their position</th>
                <th className="pb-2 pr-3 font-medium">Our position</th>
                <th className="pb-2 pr-3 font-medium">Volume</th>
                <th className="pb-2 font-medium">Opportunity</th>
              </tr>
            </thead>
            <tbody>
              {(data.opportunities ?? []).map((row) => (
                <tr key={row.keyword} className="border-b border-[#2a3f5f]/60 last:border-0">
                  <td className="py-2 pr-3 text-white">{row.keyword}</td>
                  <td className="py-2 pr-3">{row.competitorPosition}</td>
                  <td className="py-2 pr-3">{row.ourPosition || "Not ranking"}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(row.searchVolume)}</td>
                  <td className="py-2">{row.opportunityScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SeoShell>
  );
}

