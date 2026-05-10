/**
 * Hacker News scanner via the Algolia search API (free, no key).
 *
 * Targets HN posts and comments related to employment topics tech workers
 * tend to discuss: severance, layoffs, RSU vesting, non-compete, PIP,
 * resignation, harassment, equity disputes. Strong signal for a NY/NJ
 * employment firm with a tech-leaning client base.
 */

import { logger } from "./logger";

export type HNPost = {
  id: string;             // HN object id
  title: string;
  snippet: string;
  url: string;            // hn item URL
  externalUrl: string | null;
  author: string;
  points: number;
  numComments: number;
  created: number;        // unix seconds
  relevanceScore: number;
  matchedKeywords: string[];
};

export type HNScanResult = {
  posts: HNPost[];
  totalFound: number;
  scannedAt: string;
};

const QUERIES = [
  "severance",
  "layoff",
  "non-compete OR noncompete",
  "RSU vesting",
  "PIP performance improvement",
  "wrongful termination",
  "discrimination workplace",
  "wage theft",
  "harassment workplace",
];

const KEYWORDS = [
  "severance",
  "layoff",
  "fired",
  "non-compete",
  "noncompete",
  "non compete",
  "RSU",
  "stock vesting",
  "PIP",
  "wrongful termination",
  "discrimination",
  "harassment",
  "equity dispute",
  "deferred comp",
  "unpaid wages",
  "FLSA",
  "FMLA",
  "whistleblower",
  "retaliation",
];

type AlgoliaHit = {
  objectID: string;
  title?: string;
  story_text?: string;
  comment_text?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i?: number;
};

async function searchAlgolia(query: string): Promise<AlgoliaHit[]> {
  // hits ordered by date — gets us the freshest threads.
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(
    query,
  )}&tags=story&hitsPerPage=20`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ query, status: res.status }, "HN Algolia non-200");
      return [];
    }
    const data = (await res.json()) as { hits?: AlgoliaHit[] };
    return data.hits ?? [];
  } catch (err) {
    logger.warn(
      { query, error: err instanceof Error ? err.message : String(err) },
      "HN Algolia fetch failed",
    );
    return [];
  }
}

function calculateRelevance(hit: AlgoliaHit): { score: number; matched: string[] } {
  const text = `${hit.title ?? ""} ${hit.story_text ?? hit.comment_text ?? ""}`.toLowerCase();
  const matched: string[] = [];

  let score = 0;
  for (const kw of KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      matched.push(kw);
      score += 15;
    }
  }
  // Engagement boost.
  if ((hit.points ?? 0) > 50) score += 10;
  if ((hit.num_comments ?? 0) > 30) score += 5;
  // Recency boost (HN posts age fast).
  const hours = (Date.now() / 1000 - (hit.created_at_i ?? Date.now() / 1000)) / 3600;
  if (hours < 12) score += 12;
  else if (hours < 48) score += 6;
  else if (hours < 168) score += 2;

  return { score: Math.min(score, 100), matched };
}

export async function scanHackerNews(): Promise<HNScanResult> {
  const settled = await Promise.allSettled(QUERIES.map((q) => searchAlgolia(q)));
  const seen = new Set<string>();
  const out: HNPost[] = [];

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const hit of result.value) {
      if (seen.has(hit.objectID)) continue;
      seen.add(hit.objectID);
      const { score, matched } = calculateRelevance(hit);
      if (score < 15) continue;

      const snippet = (hit.story_text ?? hit.comment_text ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      out.push({
        id: hit.objectID,
        title: hit.title ?? snippet.slice(0, 80),
        snippet,
        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        externalUrl: hit.url ?? null,
        author: hit.author ?? "unknown",
        points: hit.points ?? 0,
        numComments: hit.num_comments ?? 0,
        created: hit.created_at_i ?? Math.floor(Date.now() / 1000),
        relevanceScore: score,
        matchedKeywords: matched,
      });
    }
  }

  out.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return {
    posts: out.slice(0, 50),
    totalFound: out.length,
    scannedAt: new Date().toISOString(),
  };
}
