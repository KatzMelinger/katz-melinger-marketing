/**
 * GET /api/correlation/dashboard
 *
 * Cross-channel correlation between organic ranking and AI citation. Joins:
 *   - tracked SEO keywords (with their landing URL and current rank)
 *   - AEO citations from the latest run, grouped by URL
 *
 * Surfaces three views:
 *   1. URLs that rank AND get cited (the "double-dip" winners)
 *   2. URLs that rank but DON'T get cited (lift opportunity — make them more
 *      AI-friendly: schema, FAQs, definitions, source links)
 *   3. URLs the AI cites that we don't track in SEO (likely worth tracking)
 */

import { NextResponse } from "next/server";
import { getTenantDb } from "@/lib/tenant-db";
import { getTenantConfig } from "@/lib/tenant-config";

export const runtime = "nodejs";

function normalize(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.hash = "";
    u.search = "";
    return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return null;
  }
}

export async function GET() {
  const { semrushDomain } = await getTenantConfig();
  const supabase = await getTenantDb();

  const { data: keywords } = await supabase
    .from("seo_keywords")
    .select("keyword, current_rank, search_volume, url");

  const { data: latestRun } = await supabase
    .from("aeo_runs")
    .select("id, completed_at")
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(1);

  const runId = latestRun?.[0]?.id ?? null;

  const citationsByUrl = new Map<string, { count: number; providers: Set<string>; prompts: Set<string> }>();
  if (runId) {
    const { data: responses } = await supabase
      .from("aeo_responses")
      .select("provider, prompt_id, citations")
      .eq("run_id", runId);
    for (const r of responses ?? []) {
      const cites = (r.citations as { url?: string }[] | null) ?? [];
      for (const c of cites) {
        if (!c.url) continue;
        if (!c.url.includes(semrushDomain)) continue; // we care about our own URLs here
        const norm = normalize(c.url);
        if (!norm) continue;
        const cur =
          citationsByUrl.get(norm) ??
          { count: 0, providers: new Set<string>(), prompts: new Set<string>() };
        cur.count += 1;
        cur.providers.add(r.provider as string);
        cur.prompts.add(r.prompt_id as string);
        citationsByUrl.set(norm, cur);
      }
    }
  }

  const rankedUrls = new Map<string, { rank: number | null; volume: number | null; keywords: string[] }>();
  for (const k of keywords ?? []) {
    const norm = normalize(k.url as string | null);
    if (!norm) continue;
    const cur = rankedUrls.get(norm) ?? { rank: null, volume: 0, keywords: [] };
    cur.rank = k.current_rank as number | null;
    cur.volume = (cur.volume ?? 0) + ((k.search_volume as number | null) ?? 0);
    cur.keywords.push(k.keyword as string);
    rankedUrls.set(norm, cur);
  }

  type Joined = {
    url: string;
    organicRank: number | null;
    monthlyVolume: number;
    keywords: string[];
    aiCitationCount: number;
    aiProviders: string[];
    aiPrompts: number;
  };

  const doubleWinners: Joined[] = [];
  const rankNoCite: Joined[] = [];
  const citeNoRank: Joined[] = [];

  for (const [url, info] of rankedUrls) {
    const cite = citationsByUrl.get(url);
    if (cite) {
      doubleWinners.push({
        url,
        organicRank: info.rank,
        monthlyVolume: info.volume ?? 0,
        keywords: info.keywords,
        aiCitationCount: cite.count,
        aiProviders: Array.from(cite.providers),
        aiPrompts: cite.prompts.size,
      });
    } else {
      rankNoCite.push({
        url,
        organicRank: info.rank,
        monthlyVolume: info.volume ?? 0,
        keywords: info.keywords,
        aiCitationCount: 0,
        aiProviders: [],
        aiPrompts: 0,
      });
    }
  }

  for (const [url, cite] of citationsByUrl) {
    if (rankedUrls.has(url)) continue;
    citeNoRank.push({
      url,
      organicRank: null,
      monthlyVolume: 0,
      keywords: [],
      aiCitationCount: cite.count,
      aiProviders: Array.from(cite.providers),
      aiPrompts: cite.prompts.size,
    });
  }

  // Sort each view by impact.
  doubleWinners.sort((a, b) => b.aiCitationCount + (b.monthlyVolume / 100) - (a.aiCitationCount + (a.monthlyVolume / 100)));
  rankNoCite.sort((a, b) => b.monthlyVolume - a.monthlyVolume);
  citeNoRank.sort((a, b) => b.aiCitationCount - a.aiCitationCount);

  return NextResponse.json({
    runDate: latestRun?.[0]?.completed_at ?? null,
    summary: {
      ranked: rankedUrls.size,
      cited: citationsByUrl.size,
      doubleWinners: doubleWinners.length,
      rankNoCite: rankNoCite.length,
      citeNoRank: citeNoRank.length,
    },
    doubleWinners,
    rankNoCite,
    citeNoRank,
  });
}
