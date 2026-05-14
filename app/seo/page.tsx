/**
 * SEO Ops Hub — organic search visibility + content production.
 *
 * Landing page that aggregates keyword tracking, backlinks, competitors,
 * technical SEO, and the content production pipeline. Sub-area cards
 * link out to existing detail pages.
 */

import type { Metadata } from "next";

import { HubShell, type HubCard, type HubKpi } from "@/components/hub-shell";
import { getRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SEO Ops Hub | Katz Melinger PLLC",
  description:
    "Keyword tracking, backlinks, competitors, technical health, and content production.",
};

async function fetchJsonSafe<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type KeywordsPayload = {
  tracked?: Array<{ keyword: string; position: number; estimatedTraffic?: number; trafficCost?: number }>;
  missingTargets?: string[];
};

type BacklinksPayload = {
  overview?: { authorityScore?: number; totalBacklinks?: number; referringDomains?: number };
};

type CompetitorsPayload = {
  trackedDomains?: string[];
};

export default async function SeoHubPage() {
  const base = await getRequestOrigin();

  const [keywords, backlinks, competitors] = await Promise.all([
    fetchJsonSafe<KeywordsPayload>(`${base}/api/seo/keywords`),
    fetchJsonSafe<BacklinksPayload>(`${base}/api/seo/backlinks`),
    fetchJsonSafe<CompetitorsPayload>(`${base}/api/seo/competitors`),
  ]);

  const tracked = keywords?.tracked ?? [];
  const top10Count = tracked.filter((k) => k.position > 0 && k.position <= 10).length;
  const totalTraffic = tracked.reduce((s, k) => s + (k.estimatedTraffic ?? 0), 0);
  const totalValue = tracked.reduce((s, k) => s + (k.trafficCost ?? 0), 0);
  const trackedCompetitors = competitors?.trackedDomains?.length ?? 0;
  const authorityScore = backlinks?.overview?.authorityScore ?? 0;

  const kpis: HubKpi[] = [
    {
      label: "Top-10 rankings",
      value: top10Count.toString(),
      hint: `of ${tracked.length} tracked`,
      tone: top10Count > 0 ? "emerald" : "neutral",
    },
    {
      label: "Est. monthly traffic",
      value: totalTraffic.toLocaleString(),
      hint: "From ranked keywords",
      tone: "blue",
    },
    {
      label: "Est. traffic value",
      value: "$" + Math.round(totalValue).toLocaleString(),
      hint: "Equivalent paid-search spend",
      tone: "neutral",
    },
    {
      label: "Authority score",
      value: authorityScore.toString(),
      hint: "Semrush domain authority",
      tone: authorityScore >= 30 ? "emerald" : "amber",
    },
    {
      label: "Tracked competitors",
      value: trackedCompetitors.toString(),
      hint: "Domains monitored",
      tone: "neutral",
    },
  ];

  const cards: HubCard[] = [
    {
      href: "/seo/keywords",
      label: "Keyword tracker",
      description:
        "Target keyword positions, movement, volume, KD, and per-keyword content recommendations.",
      metric: `${tracked.length} tracked`,
    },
    {
      href: "/seo/competitors",
      label: "Competitors",
      description:
        "Domains monitored alongside katzmelinger.com — keyword overlap, backlinks, content cadence.",
      metric: `${trackedCompetitors} tracked`,
    },
    {
      href: "/seo/backlinks",
      label: "Backlinks",
      description:
        "Referring domains, authority distribution, and toxicity risk for the firm's link profile.",
      metric: backlinks?.overview?.totalBacklinks
        ? `${backlinks.overview.totalBacklinks.toLocaleString()} links`
        : undefined,
    },
    {
      href: "/seo/technical",
      label: "Technical SEO",
      description:
        "Core Web Vitals, schema coverage, crawl issues, and mobile/desktop performance.",
    },
    {
      href: "/seo/opportunities",
      label: "Opportunities",
      description:
        "Open-ended SEO opportunities — competitor gaps, low-hanging keywords, content briefs.",
    },
    {
      href: "/seo/cannibalization",
      label: "Cannibalization",
      description:
        "Pages competing with each other for the same query — risks to rankings and consolidation moves.",
    },
    {
      href: "/seo/internal-links",
      label: "Internal links",
      description:
        "Link graph across the firm's site — orphans, anchor distribution, pillar pages.",
    },
    {
      href: "/local-seo",
      label: "Local SEO",
      description:
        "Local pack rankings, GBP performance, and neighborhood/borough-level visibility.",
    },
    {
      href: "/content",
      label: "Content Studio",
      description:
        "Draft library, generation, brand voice — the production engine that feeds rankings.",
    },
    {
      href: "/keyword-research",
      label: "Keyword research",
      description:
        "Discover and analyze new keyword opportunities by intent, volume, and difficulty.",
    },
    {
      href: "/search-console",
      label: "Search Console",
      description:
        "Google Search Console data — clicks, impressions, CTR, position by query/page.",
    },
    {
      href: "/seo/recent",
      label: "Recent activity",
      description:
        "Rolling 30-day timeline of ranking changes, new backlinks, and SEO events.",
    },
  ];

  return (
    <HubShell
      eyebrow="SEO Ops Hub"
      title="Organic search & content production"
      subtitle="Keyword tracking, competitor intelligence, backlink analysis, technical health, and the content engine that drives rankings."
      kpis={kpis}
      cards={cards}
      actions={[
        { href: "/seo/keywords", label: "Open keyword tracker", variant: "outline" },
        { href: "/content", label: "Create content", variant: "primary" },
      ]}
    />
  );
}
