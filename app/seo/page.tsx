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
  const apiErrors: string[] = [];
  try {
    const [keywordsRes, backlinksRes, competitorsRes] = await Promise.all([
      fetch(`${base}/api/seo/keywords`, { cache: "no-store" }),
      fetch(`${base}/api/seo/backlinks`, { cache: "no-store" }),
      fetch(`${base}/api/seo/competitors`, { cache: "no-store" }),
    ]);
    const keywords = (await keywordsRes.json()) as OverviewData;
    const backlinks = (await backlinksRes.json()) as {
      overview?: OverviewData["overview"];
      error?: string;
    };
    const competitors = (await competitorsRes.json()) as {
      semrushCompetitors?: Array<{ domain: string; commonKeywords: number }>;
      error?: string;
    };
    if (keywords.error) apiErrors.push(`Keywords API: ${keywords.error}`);
    if (backlinks.error) apiErrors.push(`Backlinks API: ${backlinks.error}`);
    if (competitors.error) apiErrors.push(`Competitors API: ${competitors.error}`);
    data = {
      ...keywords,
      overview: backlinks.overview,
      semrushCompetitors: competitors.semrushCompetitors,
    };
  } catch (e) {
    data = {
      error:
        e instanceof Error
          ? `Couldn't load SEO data: ${e.message}`
          : "Unable to load SEO overview data right now.",
    };
  }

  const trackedCount = data.tracked?.length ?? 0;
  const rankingTop10 = (data.tracked ?? []).filter(
    (item) => item.position > 0 && item.position <= 10,
  ).length;
  const missing = data.missingTargets?.length ?? 0;
  const competitors = data.semrushCompetitors ?? [];
  const authority = data.overview?.authorityScore ?? 0;
  const backlinks = data.overview?.totalBacklinks ?? 0;

  // If every counter is zero AND we got no explicit errors, something is wrong
  // upstream (Semrush returning empty, quota burnt, etc.) — say so instead of
  // pretending the dashboard rendered fine.
  const allZero =
    trackedCount === 0 &&
    rankingTop10 === 0 &&
    missing === 0 &&
    authority === 0 &&
    backlinks === 0 &&
    competitors.length === 0;

  return (
    <SeoShell
      title="SEO Intelligence Dashboard"
      subtitle="Keyword tracking, competitor intelligence, backlink analysis, and technical SEO monitoring."
    >
      {data.error ? (
        <div className="rounded-xl border border-amber-700/50 bg-[#ffffff] p-4 text-sm text-amber-800">
          {data.error}
        </div>
      ) : null}
      {apiErrors.length > 0 ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-medium mb-2">SEO API returned errors:</div>
          <ul className="list-disc pl-5 space-y-1">
            {apiErrors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-700">
            Most likely cause: SEMRUSH_API_KEY is missing, invalid, or out of
            quota. Check Vercel env vars or the Semrush account dashboard.
          </p>
        </div>
      ) : allZero ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          The page loaded but every metric came back zero. Semrush either
          returned no rows or the call silently failed. Check{" "}
          <Link href="/integrations" className="underline">
            /integrations
          </Link>{" "}
          to confirm the Semrush key is healthy.
        </div>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Tracked keywords</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(trackedCount)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Top 10 rankings</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(rankingTop10)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Missing targets</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(missing)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Authority score</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(authority)}</p>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Backlinks</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(backlinks)}</p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Trending legal keywords</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {(data.trendingKeywords ?? []).slice(0, 8).map((item) => (
              <li key={item.keyword} className="rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2">
                {item.keyword}
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
          <h2 className="text-lg font-semibold text-slate-900">Top market competitors</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            {competitors.slice(0, 8).map((item) => (
              <li
                key={item.domain}
                className="flex items-center justify-between rounded-md border border-[#e2e8f0] bg-[#ffffff] px-3 py-2"
              >
                <span>{item.domain}</span>
                <span className="tabular-nums text-slate-500">{formatNumber(item.commonKeywords)}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-xl border border-[#e2e8f0] bg-[#ffffff] p-5">
        <h2 className="text-lg font-semibold text-slate-900">Workflow shortcuts</h2>
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
              className="rounded-lg border border-[#e2e8f0] bg-[#ffffff] px-3 py-3 text-sm text-slate-700 hover:border-[#185FA5] hover:text-slate-900"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
