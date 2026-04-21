import type { Metadata } from "next";
import Link from "next/link";

import { formatNumber, SeoShell } from "@/components/seo-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Intelligence | Katz Melinger PLLC",
  description:
    "Comprehensive SEO dashboard with keyword tracking, backlinks, competitors, and technical monitoring.",
};

type OverviewData = {
  tracked?: Array<{ keyword: string; position: number }>;
  missingTargets?: string[];
  trendingKeywords?: Array<{ keyword: string }>;
  overview?: { authorityScore?: number; totalBacklinks?: number; referringDomains?: number };
  semrushCompetitors?: Array<{ domain: string; commonKeywords: number }>;
  error?: string;
};

export default async function SeoPage() {
  const base = await getRequestOrigin();

  let data: OverviewData = {};
  try {
    const [keywordsRes, backlinksRes, competitorsRes] = await Promise.all([
      fetch(`${base}/api/seo/keywords`, { cache: "no-store" }),
      fetch(`${base}/api/seo/backlinks`, { cache: "no-store" }),
      fetch(`${base}/api/seo/competitors`, { cache: "no-store" }),
    ]);
    const keywords = (await keywordsRes.json()) as OverviewData;
    const backlinks = (await backlinksRes.json()) as { overview?: OverviewData["overview"] };
    const competitors = (await competitorsRes.json()) as {
      semrushCompetitors?: Array<{ domain: string; commonKeywords: number }>;
    };
    data = {
      ...keywords,
      overview: backlinks.overview,
      semrushCompetitors: competitors.semrushCompetitors,
    };
  } catch {
    data = { error: "Unable to load SEO overview data right now." };
  }

  const trackedCount = data.tracked?.length ?? 0;
  const rankingTop10 = (data.tracked ?? []).filter(
    (item) => item.position > 0 && item.position <= 10,
  ).length;
  const missing = data.missingTargets?.length ?? 0;
  const competitors = data.semrushCompetitors ?? [];
  const authority = data.overview?.authorityScore ?? 0;
  const backlinks = data.overview?.totalBacklinks ?? 0;

  return (
    <SeoShell
      title="SEO Intelligence Dashboard"
      subtitle="Keyword tracking, competitor intelligence, backlink analysis, and technical SEO monitoring."
    >
      {data.error ? (
        <div className="rounded-xl border border-amber-700/50 bg-[#1a2540] p-4 text-sm text-amber-100">
          {data.error}
        </div>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Tracked keywords</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(trackedCount)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Top 10 rankings</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(rankingTop10)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Missing targets</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(missing)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Authority score</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(authority)}</p>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Backlinks</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(backlinks)}</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Trending legal keywords</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {(data.trendingKeywords ?? []).slice(0, 8).map((item) => (
              <li key={item.keyword} className="rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2">
                {item.keyword}
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
          <h2 className="text-lg font-semibold text-white">Top market competitors</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {competitors.slice(0, 8).map((item) => (
              <li
                key={item.domain}
                className="flex items-center justify-between rounded-md border border-[#2a3f5f] bg-[#0f1729] px-3 py-2"
              >
                <span>{item.domain}</span>
                <span className="tabular-nums text-slate-400">{formatNumber(item.commonKeywords)}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#2a3f5f] bg-[#1a2540] p-5">
        <h2 className="text-lg font-semibold text-white">Workflow shortcuts</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["/seo/keywords", "Keyword tracking & research"],
            ["/seo/backlinks", "Backlink intelligence"],
            ["/seo/competitors", "Competitor monitoring"],
            ["/seo/technical", "Technical SEO health"],
            ["/seo/competitors/add", "Add tracked competitor"],
            ["/seo/keywords/competitive", "Keyword battle view"],
            ["/seo/opportunities", "Opportunity recommendations"],
            ["/content", "SEO-driven Content Studio"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg border border-[#2a3f5f] bg-[#0f1729] px-3 py-3 text-sm text-slate-200 hover:border-[#185FA5] hover:text-white"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
