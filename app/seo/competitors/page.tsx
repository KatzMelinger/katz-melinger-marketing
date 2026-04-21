import type { Metadata } from "next";
import Link from "next/link";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Competitors | Katz Melinger PLLC",
  description: "Competitor tracking, keyword overlap, and market-share intelligence.",
};

type CompetitorsResponse = {
  trackedDomains?: string[];
  semrushCompetitors?: Array<{
    domain: string;
    commonKeywords: number;
    estimatedTraffic: number;
  }>;
};

export default async function SeoCompetitorsPage() {
  const base = await getRequestOrigin();
  const res = await fetch(`${base}/api/seo/competitors`, { cache: "no-store" });
  const data = (await res.json()) as CompetitorsResponse;

  return (
    <SeoShell
      title="Competitor Analysis"
      subtitle="Monitor legal-market competitors, compare keyword visibility, and drill into domain-level intelligence."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Tracked competitors</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.trackedDomains?.length ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Semrush market set</p>
          <p className="mt-2 text-2xl font-semibold">{formatNumber(data.semrushCompetitors?.length ?? 0)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Actions</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Link href="/seo/competitors/add" className="rounded bg-[#185FA5] px-2 py-1 text-white">
              Add competitor
            </Link>
            <Link href="/seo/keywords/competitive" className="rounded border border-[#2a3f5f] px-2 py-1 text-slate-200">
              Keyword battles
            </Link>
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Tracked competitor domains</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data.trackedDomains ?? []).map((domain) => (
              <li key={domain} className="flex items-center justify-between rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                <span className="text-slate-200">{domain}</span>
                <Link
                  href={`/seo/competitors/${encodeURIComponent(domain)}`}
                  className="rounded border border-[#2a3f5f] px-2 py-1 text-xs text-slate-200 hover:border-[#185FA5] hover:text-white"
                >
                  View details
                </Link>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold">Market visibility snapshot</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="border-b border-[#2a3f5f] text-slate-400">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Domain</th>
                  <th className="pb-2 pr-3 font-medium">Common keywords</th>
                  <th className="pb-2 font-medium">Traffic est.</th>
                </tr>
              </thead>
              <tbody>
                {(data.semrushCompetitors ?? []).slice(0, 15).map((item) => (
                  <tr key={item.domain} className="border-b border-[#2a3f5f]/60 last:border-0">
                    <td className="py-2 pr-3 text-white">{item.domain}</td>
                    <td className="py-2 pr-3">{formatNumber(item.commonKeywords)}</td>
                    <td className="py-2">{formatNumber(item.estimatedTraffic)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </SeoShell>
  );
}

